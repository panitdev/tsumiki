// English dictionary. The canonical set of keys: every other locale must
// mirror this exact structure (compare with `structureOf` in tests/i18n.test.ts).
//
// Messages are nested; use next-intl syntax for rich messages:
//   {name}        simple interpolation
//   {count, plural, one {...} other {...}}   ICU plurals
//   <strong>text</strong>   rich text (pass tag callbacks to t.rich)
//
// Usage:
//   server components: await getTranslations() → t("home.title")
//   client components: useTranslations() from "next-intl/react"

export const en = {
  app: {
    name: "Tsumiki",
    description: "A live viewer for Minecraft structures.",
  },
  home: {
    title: "Structures",
  },
  auth: {
    signedOut: {
      title: "Signed out of Tsumiki",
      signIn: "Sign in",
    },
    error: {
      retry: "Retry sign-in",
      restart: "Start sign-in again",
      surgeCode: "Surge error code {code}",
    },
  },
  header: {
    signOut: "Sign out",
    language: "Language",
  },
  viewer: {
    back: "Structures",
    blockCount: "{count, plural, one {block} other {blocks}}",
    displayCount: "{count, plural, one {block display} other {block displays}}",
    dimensionsTitle: "Dimensions in X, Y, Z order",
    updateFailed: "Update failed",
    retry: "Retry",
    lastGoodBuild: "Showing the last good build. {error}",
    dragInstructions: "Drag to orbit · Shift + drag to pan · Scroll to zoom",
    touchInstructions: "Drag to orbit · Two fingers to pan or zoom",
    keyboardInstructions:
      "With the canvas focused, use arrow keys to orbit, Shift and arrow keys to pan, plus and minus to zoom, and Home to frame the structure.",
    controls: "Structure controls",
    ySlice: "Y slice",
    allLayers: "All layers",
    upToY: "Up to Y {y}",
    yLabel: "Y {y}",
    showAll: "Show all",
    groups: "Groups",
    blockInspector: "Block inspector",
    export: "Export",
    connecting: "Connecting",
    live: "Live",
    reconnecting: "Reconnecting",
    pickHint: "Hover or tap to see a block’s ID, position and group.",
  },
  canvas: {
    structure: "3D structure",
    cameraControls: "Camera controls",
    zoomIn: "Zoom in",
    zoomInTitle: "Zoom in (+)",
    zoomOut: "Zoom out",
    zoomOutTitle: "Zoom out (−)",
    frame: "Frame structure",
    frameTitle: "Frame structure (Home)",
    tryAgain: "Try again",
    restoringGraphics: "Restoring graphics",
    loadingAssets: "Loading Minecraft assets",
    loadingStructure: "Loading structure",
    empty: "This structure is empty.",
    atlasError: "Couldn’t load the Minecraft texture atlas.",
    renderError: "Couldn’t render the structure.",
  },
  list: {
    tryAgain: "Try again",
    couldntLoad: "Couldn’t load structures.",
    loading: "Loading structures",
    emptyTitle: "No structures yet",
    emptyHint: "Connect an agent, then ask it to open a named structure.",
    ariaStructures: "Structures",
  },
  tree: {
    collapse: "Collapse",
    expand: "Expand",
    isolate: "Isolate",
    showOnlyThis: "Show only this",
    show: "Show",
    hide: "Hide",
    empty: "Nothing has been built yet.",
    moreNotListed: "{count} more not listed",
  },
  download: {
    format: "Format",
    javaVersion: "Java version",
    preparing: "Preparing…",
    download: "Download",
    failed: "Couldn’t download the structure.",
  },
  agent: {
    connect: "Connect an agent",
    headingDescription: "Pick your client to add Tsumiki.",
    remoteDescription: "Add Tsumiki as a remote MCP server.",
    notSupported: "Not supported yet.",
    back: "Back",
    mcpUrl: "MCP URL",
    authorization: "Authorization",
    copy: "Copy to clipboard",
    signInGeneric: "Sign in with Surge when your client asks you to.",
    signInClaude: "Sign in with Surge when Claude asks you to.",
    signInClaudeCode: "Sign in with Surge when Claude Code opens the browser.",
    signInCodex: "Sign in with Surge when Codex opens the browser.",
    noSignIn: "No sign-in needed.",
    claudeWebPublic:
      "In Claude, go to <strong>Customize › Connectors</strong>, choose <strong>+ Add › Add custom connector</strong>, and paste the URL below.",
    claudeWebLocal:
      "Run this site on a public HTTPS address, then add it as a custom connector in Claude’s settings.",
    chatgptLimitation:
      "ChatGPT’s connectors can read remote servers but only run search and fetch — they cannot call Tsumiki’s bash tool, so it’s not usable as a connector yet.",
    runFromProject: "From your project folder, run:",
    codexOauthHint:
      "If Codex can’t sign in on its own, register an OAuth client with Surge and add <code>--oauth-client-id {clientId}</code> to the command.",
    manualIntro:
      "Paste the URL below into your client’s server settings as a remote (Streamable HTTP) MCP server.",
    multiClientTitle: "Keeping clients apart",
    multiClientBody:
      "Each connected client keeps its own current structure, so two agents can work side by side without getting in each other’s way.",
    fineprint:
      "Claude, ChatGPT and Codex are trademarks of their respective owners. Tsumiki is not affiliated with or endorsed by them.",
    claudeWeb: "Claude",
    claudeWebDesc: "claude.ai",
    chatgpt: "ChatGPT",
    chatgptDesc: "chatgpt.com",
    claudeCode: "Claude Code",
    claudeCodeDesc: "Anthropic’s terminal agent",
    codex: "Codex",
    codexDesc: "OpenAI’s coding agent",
    manual: "Manual (MCP)",
    manualDesc: "Any MCP client, paste the URL",
  },
} as const;

// Widen the literal string types from `as const` so other locales can supply
// their own copy for every key while keeping the exact key structure.
type Widen<T> = T extends string
  ? string
  : { [Key in keyof T]: Widen<T[Key]> };

export type Messages = Widen<typeof en>;

export default en;
