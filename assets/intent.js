/**
 * Intent NLU — richer recipes + entity targeting + portrait/voice phrases.
 */
const LuminaIntent = (() => {
  const recipes = [
    {
      test: /reconstruct\s+sky|sky\s+detail|scattering|quantum\s*dr|highlight\s+recover|blown.?out|recover\s+highlights/i,
      title: "Quantum DR Recovery",
      type: "recover",
      branch: "dr",
      params: { drRecovery: 0.78, refractiveHaze: 0.42, cloudDensity: 0.52 },
      sliders: [
        { key: "drRecovery", label: "Scatter Recover", min: 0, max: 1, step: 0.01 },
        { key: "refractiveHaze", label: "Refractive Haze", min: 0, max: 1, step: 0.01 },
        { key: "cloudDensity", label: "Cloud Density", min: 0, max: 1, step: 0.01 },
      ],
      toast: "Reconstructed sky detail from photon-scattering model",
      split: true,
    },
    {
      test: /golden\s*hour|sunset|dramatic\s+sunset|warm\s+light|amber\s+sky|make\s+the\s+reconstructed\s+sky/i,
      title: "Light Field Shift: Sunset",
      type: "relight",
      branch: "light",
      params: { goldenHour: 0.8, sunAngle: 55, atmosphericHaze: 0.45, bounceReflectance: 0.55 },
      sliders: [
        { key: "sunAngle", label: "Sun Angle", min: 0, max: 90, step: 1 },
        { key: "atmosphericHaze", label: "Atmospheric Haze", min: 0, max: 1, step: 0.01 },
        { key: "bounceReflectance", label: "Bounce Reflectance", min: 0, max: 1, step: 0.01 },
        { key: "goldenHour", label: "Golden Intensity", min: 0, max: 1, step: 0.01 },
      ],
      toast: "Shifted light field toward golden hour",
    },
    {
      test: /shift\s+ambient|ambient\s+light|dramatic\s+light|relight|lighting\s+mood/i,
      title: "Ambient Light Field",
      type: "relight",
      branch: "light",
      params: { goldenHour: 0.45, sunAngle: 40, atmosphericHaze: 0.5 },
      sliders: [
        { key: "sunAngle", label: "Sun Angle", min: 0, max: 90, step: 1 },
        { key: "atmosphericHaze", label: "Atmospheric Haze", min: 0, max: 1, step: 0.01 },
        { key: "bounceReflectance", label: "Bounce Reflectance", min: 0, max: 1, step: 0.01 },
      ],
      toast: "Adjusted ambient light field",
    },
    {
      test: /haze|fog|atmosphere|volumetric\s+cloud/i,
      title: "Atmospheric Density",
      type: "atmosphere",
      branch: "root",
      params: { atmosphericHaze: 0.65, refractiveHaze: 0.55, cloudDensity: 0.55 },
      sliders: [
        { key: "atmosphericHaze", label: "Atmospheric Haze", min: 0, max: 1, step: 0.01 },
        { key: "refractiveHaze", label: "Refractive Haze", min: 0, max: 1, step: 0.01 },
        { key: "cloudDensity", label: "Cloud Density", min: 0, max: 1, step: 0.01 },
      ],
      toast: "Tuned atmospheric scattering",
    },
    {
      test: /cooler|cold|blue\s+hour|desaturat|cool\s+spectral/i,
      title: "Cool Spectral Shift",
      type: "grade",
      branch: "root",
      params: { goldenHour: 0.05, atmosphericHaze: 0.55, coolShift: 0.7, drRecovery: 0.3 },
      sliders: [
        { key: "coolShift", label: "Cool Shift", min: 0, max: 1, step: 0.01 },
        { key: "atmosphericHaze", label: "Cool Haze", min: 0, max: 1, step: 0.01 },
      ],
      toast: "Applied cool spectral grade",
    },
    {
      test: /portrait|skin|subsurface|pores|beauty/i,
      title: "Portrait Material",
      type: "portrait",
      branch: "root",
      params: { sssDepth: 0.55, surfaceTexture: 0.45, catchlight: 0.4 },
      sliders: [
        { key: "sssDepth", label: "SSS Depth", min: 0, max: 1, step: 0.01 },
        { key: "surfaceTexture", label: "Pores / Texture", min: 0, max: 1, step: 0.01 },
      ],
      toast: "Applied portrait material model",
      entityHint: "skin",
    },
    {
      test: /catchlight|iris|eyes?\b|eye\s+light/i,
      title: "Eye Reflectance",
      type: "portrait",
      branch: "root",
      params: { catchlight: 0.75, irisReflectance: 0.65 },
      sliders: [
        { key: "catchlight", label: "Catchlight Intensity", min: 0, max: 1, step: 0.01 },
        { key: "irisReflectance", label: "Iris Reflectance", min: 0, max: 1, step: 0.01 },
      ],
      toast: "Tuned eye catchlight & iris reflectance",
      entityHint: "eyes",
    },
    {
      test: /blend\s+(sky|sunset|branches)|merge\s+branches/i,
      title: "Blend",
      type: "blend",
      branch: "merge",
      params: {},
      sliders: [],
      toast: "Preparing blend — select two nodes if needed",
      isBlend: true,
    },
  ];

  function parse(text) {
    const trimmed = text.trim();
    if (!trimmed) return null;

    // "select sky" / "focus eyes"
    const select = trimmed.match(/^(select|focus|show|hover)\s+(.+)$/i);
    if (select) {
      return { selectEntity: select[2].trim(), toast: `Selecting ${select[2].trim()}` };
    }

    for (const recipe of recipes) {
      if (recipe.test.test(trimmed)) {
        // numeric overrides: "sun angle 62"
        const params = { ...recipe.params };
        const angle = trimmed.match(/sun\s*angle\s*[:=]?\s*(\d+)/i);
        if (angle) params.sunAngle = Number(angle[1]);
        const pct = trimmed.match(/(\d+)\s*%/);
        if (pct && params.goldenHour !== undefined) params.goldenHour = Number(pct[1]) / 100;
        return { ...recipe, params, prompt: trimmed };
      }
    }

    return {
      title: "Intent Op",
      type: "intent",
      branch: "root",
      params: { atmosphericHaze: 0.4, bounceReflectance: 0.4 },
      sliders: [
        { key: "atmosphericHaze", label: "Influence", min: 0, max: 1, step: 0.01 },
        { key: "bounceReflectance", label: "Material Response", min: 0, max: 1, step: 0.01 },
      ],
      toast: `Interpreted intent: “${trimmed.slice(0, 48)}”`,
      prompt: trimmed,
    };
  }

  return { parse, recipes };
})();
