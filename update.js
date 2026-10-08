module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        path: "app/SadTalker",
        message: "git pull --ff-only"
      }
    },
    {
      method: "shell.run",
      params: {
        venv: "env",
        path: "app/SadTalker",
        message: [
          "uv pip install -r requirements.txt",
          "uv pip install gradio==4.44.1 gradio-client==1.3.0 fastapi==0.115.2 starlette==0.40.0 huggingface-hub==0.25.2 imageio-ffmpeg python-multipart edge-tts==7.2.8",
          "python ../download_sadtalker_models.py"
        ]
      }
    }
  ]
}
