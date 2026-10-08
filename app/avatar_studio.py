"""SadTalker-powered, localhost-only talking avatar studio."""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
import threading
import tempfile
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parent
HEIDI_IMAGE = ROOT / "avatar-heidi.jpg"
sys.path.insert(0, str(ROOT / "SadTalker"))

# Make the bundled ffmpeg executable visible to SadTalker's video compositor.
try:
    import imageio_ffmpeg

    ffmpeg = Path(imageio_ffmpeg.get_ffmpeg_exe())
    os.environ["PATH"] = str(ffmpeg.parent) + os.pathsep + os.environ.get("PATH", "")
except Exception:
    pass

import gradio as gr
import gradio_client.utils as gradio_utils
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from src.gradio_demo import SadTalker
import uvicorn


engine = SadTalker(checkpoint_path="checkpoints", config_path="src/config", lazy_load=True)
generation_lock = threading.Lock()

# Gradio Client 1.3's API schema parser assumes every JSON Schema node is a
# mapping. Pydantic 2 emits boolean schemas for additionalProperties; treat
# those unconstrained nodes as Any so Gradio can build its API description.
_parse_schema = gradio_utils._json_schema_to_python_type


def _parse_compatible_schema(schema, defs):
    if isinstance(schema, bool):
        return "Any"
    return _parse_schema(schema, defs)


gradio_utils._json_schema_to_python_type = _parse_compatible_schema


def synthesize_text(text, voice, output_path):
    import edge_tts

    asyncio.run(edge_tts.Communicate(text, voice).save(str(output_path)))


def generate(face_path, upload_audio, recorded_audio, speech_source, speech_text, tts_voice, resolution, preprocess, pose_style, expression_scale, enhance_face):
    audio_path = recorded_audio or upload_audio
    if not face_path:
        raise gr.Error("Add a face photo first.")

    if speech_source == "Typed text":
        if not (speech_text or "").strip():
            raise gr.Error("Type what you want the avatar to say.")
        if len(speech_text) > 5000:
            raise gr.Error("Keep typed speech under 5,000 characters.")
    elif not audio_path:
        raise gr.Error("Upload a voice recording or record your voice first.")

    with tempfile.TemporaryDirectory(prefix="lumina-avatar-") as scratch:
        face_copy = Path(scratch) / ("face" + Path(face_path).suffix.lower())
        shutil.copy2(face_path, face_copy)
        if speech_source == "Typed text":
            audio_copy = Path(scratch) / "voice.mp3"
            try:
                synthesize_text(speech_text.strip(), tts_voice, audio_copy)
            except Exception as exc:
                raise gr.Error(f"Could not create the spoken voice. Check your internet connection and try again. ({exc})") from exc
        else:
            audio_copy = Path(scratch) / ("voice" + Path(audio_path).suffix.lower())
            shutil.copy2(audio_path, audio_copy)
        with generation_lock:
            result_path = engine.test(
                str(face_copy),
                str(audio_copy),
                preprocess=preprocess,
                still_mode=False,
                use_enhancer=enhance_face,
                batch_size=1,
                size=int(resolution),
                pose_style=int(pose_style),
                exp_scale=float(expression_scale),
                result_dir="results",
            )
    return str(Path(result_path).resolve())


with gr.Blocks(
    title="Lumina AI Talking Avatar",
    analytics_enabled=False,
    css="footer { visibility: hidden } .gradio-container { max-width: 1320px !important }",
) as demo:
    gr.Markdown(
        """
# AI Talking Avatar
Create a moving talking-head video from Heidi’s portrait and your voice. Drag a
portrait into the photo area, then choose a recording or type what the avatar should
say. Typed text uses a natural online neural voice (Microsoft Edge TTS); the text is
sent to that service. Portrait animation runs locally.
        """
    )
    with gr.Row(equal_height=False):
        with gr.Column(scale=1):
            face = gr.Image(
                value=str(HEIDI_IMAGE),
                label="Face photo — drag and drop to replace Heidi",
                sources=["upload"],
                type="filepath",
                height=430,
            )
            speech_source = gr.Radio(
                ["Uploaded/recorded voice", "Typed text"],
                value="Uploaded/recorded voice",
                label="Choose what the avatar says",
            )
            speech_text = gr.Textbox(
                label="Type the words for your avatar",
                placeholder="Write a short greeting or script…",
                lines=4,
                max_lines=8,
                max_length=5000,
                visible=False,
            )
            tts_voice = gr.Dropdown(
                ["en-US-AriaNeural", "en-US-JennyNeural", "en-US-GuyNeural", "en-GB-SoniaNeural", "en-GB-RyanNeural"],
                value="en-US-AriaNeural",
                label="Speaking voice",
                info="Natural neural voices; requires an internet connection.",
                visible=False,
            )
            upload_audio = gr.Audio(label="Upload a voice recording", sources=["upload"], type="filepath")
            recorded_audio = gr.Audio(label="Or record your voice", sources=["microphone"], type="filepath")
            speech_source.change(
                lambda source: (
                    gr.update(visible=source == "Typed text"),
                    gr.update(visible=source == "Typed text"),
                    gr.update(visible=source == "Uploaded/recorded voice"),
                    gr.update(visible=source == "Uploaded/recorded voice"),
                ),
                inputs=speech_source,
                outputs=[speech_text, tts_voice, upload_audio, recorded_audio],
            )
        with gr.Column(scale=1):
            resolution = gr.Radio(
                [256, 512], value=512, label="Face detail",
                info="512 is sharper but very slow on this GTX 1060. Choose 256 for faster renders.",
            )
            preprocess = gr.Radio(
                ["full", "extfull", "crop", "extcrop"],
                value="full",
                label="Portrait framing",
                info="Full keeps the original portrait and animates the face in place.",
            )
            pose_style = gr.Slider(0, 46, value=0, step=1, label="Pose style")
            expression_scale = gr.Slider(
                0.8, 1.5, value=1.15, step=0.05, label="Expression intensity",
                info="Adds more visible mouth and facial movement.",
            )
            enhance_face = gr.Checkbox(
                value=True, label="Restore face detail with GFPGAN",
                info="Sharper eyes and mouth; slower, and may subtly alter facial details.",
            )
            generate_button = gr.Button("Generate talking video", variant="primary")
            result = gr.Video(label="Generated talking avatar", height=430)
    generate_button.click(
        fn=generate,
        inputs=[
            face, upload_audio, recorded_audio, speech_source, speech_text, tts_voice,
            resolution, preprocess, pose_style, expression_scale, enhance_face,
        ],
        outputs=result,
        api_name="generate",
    )


if __name__ == "__main__":
    api = FastAPI(title="Lumina AI Talking Avatar")
    api.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://127.0.0.1:5177",
            "http://localhost:5177",
        ],
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )

    @api.get("/api/health")
    def health():
        return {"status": "ready", "model": "SadTalker", "default_face": "Heidi"}

    @api.post("/api/generate")
    async def generate_api(
        face: UploadFile = File(...),
        voice: UploadFile | None = File(None),
        speech_source: str = Form("Uploaded/recorded voice"),
        text: str = Form(""),
        tts_voice: str = Form("en-US-AriaNeural"),
        resolution: int = Form(256),
        preprocess: str = Form("crop"),
        pose_style: int = Form(0),
        expression_scale: float = Form(1.15),
        enhance_face: bool = Form(True),
    ):
        with tempfile.TemporaryDirectory(prefix="lumina-api-") as scratch:
            face_path = Path(scratch) / ("face" + Path(face.filename or "face.png").suffix.lower())
            face_path.write_bytes(await face.read())
            voice_path = None
            if voice:
                voice_path = Path(scratch) / ("voice" + Path(voice.filename or "voice.wav").suffix.lower())
                voice_path.write_bytes(await voice.read())
            from starlette.concurrency import run_in_threadpool

            output = await run_in_threadpool(
                generate,
                str(face_path), None, str(voice_path) if voice_path else None,
                speech_source, text, tts_voice, resolution, preprocess, pose_style,
                expression_scale, enhance_face,
            )
        return FileResponse(output, media_type="video/mp4", filename="talking-avatar.mp4")

    api = gr.mount_gradio_app(api, demo.queue(default_concurrency_limit=1), path="/")
    uvicorn.run(
        api,
        host="127.0.0.1",
        port=int(os.environ.get("GRADIO_SERVER_PORT", "7860")),
        log_level="info",
    )
