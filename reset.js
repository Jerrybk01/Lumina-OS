module.exports = {
  run: [
    {
      method: "fs.rm",
      params: {
        path: "app/SadTalker/env"
      }
    },
    {
      method: "fs.rm",
      params: {
        path: "app/SadTalker/checkpoints"
      }
    },
    {
      method: "log",
      params: {
        raw: "Removed the avatar environment and model weights. Generated videos and source files were kept."
      }
    }
  ]
}
