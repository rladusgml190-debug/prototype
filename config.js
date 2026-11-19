// 프로토타입 설정 — 여기 값만 바꾸면 돼요.
window.APP_CONFIG = {
  SUPABASE_URL: "https://neoisnzhuilcfqrgnewy.supabase.co",
  // 공개용(publishable) 키예요. 브라우저에 노출돼도 괜찮도록 DB 보안 규칙(RLS)이 막고 있어요.
  SUPABASE_KEY: "sb_publishable_4m1qpPaiR2k_yotXySvWiw_8jH5xh4V",
  // 로그인 버튼을 켜고 끌 수 있어요. 각 서비스의 키를 Supabase에 등록한 뒤 true로 바꿔 주세요.
  LOGIN: { google: true, kakao: true, naver: true },
  // 네이버는 Supabase '커스텀 OAuth' 공급자로 등록해요. 등록할 때 쓴 이름과 같아야 해요.
  NAVER_PROVIDER: "custom:naver",
  // 문의 이메일 (푸터와 약관에 표시돼요)
  CONTACT_EMAIL: "rladusgml190@gmail.com",
  // 사이트가 올라간 경로 (GitHub Pages: /저장소이름/, Netlify처럼 주소 맨 앞이면 /)
  BASE_PATH: "/prototype/"
};
