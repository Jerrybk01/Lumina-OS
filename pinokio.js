module.exports = {
  version: "7.0",
  title: "BUKA PHOTO PRO + AI Talking Avatar",
  description: "Photo editor and local, audio-driven talking portrait studio.",
  icon: "icon.svg",
  menu: async (kernel, info) => {
    const installed = info.exists("app/SadTalker/env") &&
      info.exists("app/SadTalker/checkpoints/SadTalker_V0.0.2_256.safetensors");
    const running = {
      install: info.running("install.js"),
      start: info.running("start.js"),
      update: info.running("update.js"),
      reset: info.running("reset.js")
    };
    const editor = {
      icon: "fa-solid fa-image",
      text: "Open Photo Editor",
      href: "index.html"
    };

    if (running.install) {
      return [{ default: true, icon: "fa-solid fa-plug", text: "Installing AI avatar…", href: "install.js" }, editor];
    }
    if (running.update) {
      return [{ default: true, icon: "fa-solid fa-terminal", text: "Updating AI avatar…", href: "update.js" }, editor];
    }
    if (running.reset) {
      return [{ default: true, icon: "fa-solid fa-terminal", text: "Resetting AI avatar…", href: "reset.js" }, editor];
    }
    if (!installed) {
      return [
        { default: true, icon: "fa-solid fa-plug", text: "Install AI Talking Avatar", href: "install.js" },
        editor
      ];
    }
    if (running.start) {
      const local = info.local("start.js");
      if (local && local.url) {
        return [
          { default: true, icon: "fa-solid fa-rocket", text: "Open AI Talking Avatar", href: local.url },
          { icon: "fa-solid fa-terminal", text: "Avatar Studio Terminal", href: "start.js" },
          editor,
          { icon: "fa-solid fa-plug", text: "Update Avatar Studio", href: "update.js" },
          { icon: "fa-regular fa-circle-xmark", text: "Reset Avatar Models", href: "reset.js" }
        ];
      }
      return [{ default: true, icon: "fa-solid fa-terminal", text: "Starting AI Talking Avatar…", href: "start.js" }, editor];
    }
    return [
      { default: true, icon: "fa-solid fa-power-off", text: "Start AI Talking Avatar", href: "start.js" },
      editor,
      { icon: "fa-solid fa-plug", text: "Update Avatar Studio", href: "update.js" },
      { icon: "fa-regular fa-circle-xmark", text: "Reset Avatar Models", href: "reset.js" }
    ];
  }
}
