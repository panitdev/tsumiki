// Korean dictionary. Must mirror the key structure of en.ts exactly
// (compare with `structureOf` in tests/i18n.test.ts).

import type { Messages } from "./en";

export const ko: Messages = {
  app: {
    name: "Tsumiki",
    description: "Minecraft 구조물을 실시간으로 보는 뷰어입니다.",
  },
  home: {
    title: "구조물",
  },
  auth: {
    signedOut: {
      title: "Tsumiki에서 로그아웃되었습니다",
      signIn: "로그인",
    },
    error: {
      retry: "로그인 다시 시도",
      restart: "로그인 처음부터 다시 시작",
      surgeCode: "Surge 오류 코드 {code}",
    },
  },
  header: {
    signOut: "로그아웃",
    language: "언어",
  },
  viewer: {
    back: "구조물",
    blockCount: "블록 {count}개",
    displayCount: "블록 디스플레이 {count}개",
    dimensionsTitle: "X, Y, Z 순서의 크기",
    updateFailed: "업데이트 실패",
    retry: "다시 시도",
    lastGoodBuild: "마지막으로 정상 빌드된 상태를 표시합니다. {error}",
    dragInstructions: "드래그로 회전 · Shift + 드래그로 이동 · 스크롤로 확대/축소",
    touchInstructions: "드래그로 회전 · 두 손가락으로 이동 또는 확대/축소",
    keyboardInstructions:
      "캔버스에 포커스가 있을 때 방향 키로 회전하고, Shift + 방향 키로 이동하며, +와 -로 확대/축소하고, Home으로 구조물을 맞춥니다.",
    controls: "구조물 컨트롤",
    ySlice: "Y 슬라이스",
    allLayers: "전체 레이어",
    upToY: "Y {y}까지",
    yLabel: "Y {y}",
    showAll: "모두 표시",
    groups: "그룹",
    blockInspector: "블록 검사기",
    export: "내보내기",
    connecting: "연결 중",
    live: "연결됨",
    reconnecting: "재연결 중",
    pickHint: "마우스를 올리거나 탭하면 블록의 ID, 위치, 그룹이 표시됩니다.",
  },
  canvas: {
    structure: "3D 구조물",
    cameraControls: "카메라 컨트롤",
    zoomIn: "확대",
    zoomInTitle: "확대 (+)",
    zoomOut: "축소",
    zoomOutTitle: "축소 (−)",
    frame: "구조물 맞추기",
    frameTitle: "구조물 맞추기 (Home)",
    tryAgain: "다시 시도",
    restoringGraphics: "그래픽 복구 중",
    loadingAssets: "Minecraft 에셋 불러오는 중",
    loadingStructure: "구조물 불러오는 중",
    empty: "이 구조물은 비어 있습니다.",
    atlasError: "Minecraft 텍스처 아틀라스를 불러올 수 없습니다.",
    renderError: "구조물을 렌더링할 수 없습니다.",
  },
  list: {
    tryAgain: "다시 시도",
    couldntLoad: "구조물을 불러올 수 없습니다.",
    loading: "구조물 불러오는 중",
    emptyTitle: "아직 구조물이 없습니다",
    emptyHint: "에이전트를 연결한 뒤 이름으로 구조물을 열어 달라고 요청하세요.",
    ariaStructures: "구조물",
  },
  tree: {
    collapse: "접기",
    expand: "펼치기",
    isolate: "분리 보기",
    showOnlyThis: "이것만 표시",
    show: "표시",
    hide: "숨기기",
    empty: "아직 만들어진 것이 없습니다.",
    moreNotListed: "{count}개 더 있음 (표시되지 않음)",
  },
  download: {
    format: "형식",
    javaVersion: "Java 버전",
    preparing: "준비 중…",
    download: "다운로드",
    failed: "구조물을 다운로드할 수 없습니다.",
  },
  agent: {
    connect: "에이전트 연결",
    headingDescription: "Tsumiki를 추가할 클라이언트를 고르세요.",
    remoteDescription: "Tsumiki를 원격 MCP 서버로 추가합니다.",
    notSupported: "아직 지원되지 않습니다.",
    back: "뒤로",
    mcpUrl: "MCP URL",
    authorization: "인증",
    copy: "클립보드로 복사",
    signInGeneric: "클라이언트가 요청하면 Surge로 로그인하세요.",
    signInClaude: "Claude가 요청하면 Surge로 로그인하세요.",
    signInClaudeCode: "Claude Code가 브라우저를 열면 Surge로 로그인하세요.",
    signInCodex: "Codex가 브라우저를 열면 Surge로 로그인하세요.",
    noSignIn: "로그인이 필요하지 않습니다.",
    claudeWebPublic:
      "Claude에서 <strong>Customize › Connectors</strong>로 이동해 <strong>+ Add › Add custom connector</strong>를 선택하고 아래 URL을 붙여넣으세요.",
    claudeWebLocal:
      "이 사이트를 공개 HTTPS 주소로 실행한 뒤 Claude 설정에서 사용자 지정 커넥터로 추가하세요.",
    chatgptLimitation:
      "ChatGPT의 커넥터는 원격 서버를 읽을 수 있지만 search와 fetch만 실행할 수 있어 Tsumiki의 bash 도구를 호출할 수 없으므로, 아직 커넥터로 사용할 수 없습니다.",
    runFromProject: "프로젝트 폴더에서 다음을 실행하세요:",
    codexOauthHint:
      "Codex가 스스로 로그인하지 못하면 Surge에 OAuth 클라이언트를 등록하고 명령어에 <code>--oauth-client-id {clientId}</code>를 추가하세요.",
    manualIntro:
      "아래 URL을 클라이언트의 서버 설정에 원격 (Streamable HTTP) MCP 서버로 붙여넣으세요.",
    multiClientTitle: "클라이언트 분리 유지",
    multiClientBody:
      "연결된 각 클라이언트는 자체 현재 구조물을 유지하므로, 두 에이전트가 서로 방해하지 않고 나란히 작업할 수 있습니다.",
    fineprint:
      "Claude, ChatGPT, Codex는 각 소유자의 상표입니다. Tsumiki는 이들과 제휴하거나 승인받지 않았습니다.",
    claudeWeb: "Claude",
    claudeWebDesc: "claude.ai",
    chatgpt: "ChatGPT",
    chatgptDesc: "chatgpt.com",
    claudeCode: "Claude Code",
    claudeCodeDesc: "Anthropic의 터미널 에이전트",
    codex: "Codex",
    codexDesc: "OpenAI의 코딩 에이전트",
    manual: "수동 (MCP)",
    manualDesc: "모든 MCP 클라이언트, URL을 붙여넣기",
  },
};

export default ko;
