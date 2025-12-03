const fallbackVersion = "dev";

const versionFromBuild =
  typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined;

export const APP_VERSION: string =
  typeof versionFromBuild === "string" && versionFromBuild.trim().length > 0
    ? versionFromBuild
    : fallbackVersion;
