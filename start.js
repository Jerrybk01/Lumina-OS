module.exports = {
  daemon: true,
  run: [
    {
      method: "shell.run",
      params: {
        venv: "env",
        env: {
          GRADIO_SERVER_PORT: "{{port}}",
          GRADIO_ANALYTICS_ENABLED: "False",
          HF_HUB_DISABLE_TELEMETRY: "1"
        },
        path: "app/SadTalker",
        message: [
          "python ../avatar_studio.py"
        ],
        on: [{
          event: "/(http:\\/\\/[0-9.:]+)/",
          done: true
        }]
      }
    },
    {
      method: "local.set",
      params: {
        url: "{{input.event[1]}}"
      }
    }
  ]
}
