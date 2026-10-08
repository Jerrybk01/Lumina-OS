module.exports = {
  requires: {
    bundle: "ai"
  },
  run: [
    {
      when: "{{!exists('app/SadTalker')}}",
      method: "shell.run",
      params: {
        message: "git clone https://github.com/OpenTalker/SadTalker.git app/SadTalker"
      }
    },
    {
      method: "shell.run",
      params: {
        venv: "env",
        path: "app/SadTalker",
        message: [
          "{{gpu === 'nvidia' ? 'uv pip install torch==1.12.1+cu113 torchvision==0.13.1+cu113 torchaudio==0.12.1 --extra-index-url https://download.pytorch.org/whl/cu113' : 'uv pip install torch==1.12.1 torchvision==0.13.1 torchaudio==0.12.1 --index-url https://download.pytorch.org/whl/cpu'}}",
          "uv pip install -r requirements.txt",
          "uv pip install gradio==4.44.1 gradio-client==1.3.0 fastapi==0.115.2 starlette==0.40.0 huggingface-hub==0.25.2 imageio-ffmpeg python-multipart edge-tts==7.2.8"
        ]
      }
    },
    {
      method: "shell.run",
      params: {
        venv: "env",
        path: "app/SadTalker",
        message: "python ../download_sadtalker_models.py"
      }
    },
    {
      method: "log",
      params: {
        raw: "Talking Avatar install complete. Start AI Talking Avatar from the menu."
      }
    }
  ]
}
