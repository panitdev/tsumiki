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
    },
  },
  header: {
    signOut: "로그아웃",
    language: "언어",
  },
};

export default ko;
