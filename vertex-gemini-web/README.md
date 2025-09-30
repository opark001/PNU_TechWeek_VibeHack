# Vertex AI Gemini 2.5 Flash / Flash Image (aka nano-banana) Web 테스트

Vertex AI의 Gemini 2.5 Flash(텍스트/멀티모달) 및 Gemini 2.5 Flash Image(nano-banana, 이미지 생성/편집 Preview)를 웹에서 빠르게 테스트하는 Node 백엔드 프록시 + 정적 웹 UI 예제입니다.

- 서버: Node.js(Express)로 Vertex AI REST `generateContent` 엔드포인트를 호출 (google-auth-library를 사용해 ADC 토큰 획득)
- 프런트엔드: 간단한 HTML/JS로 텍스트 또는 이미지 생성 요청 전송

공식 문서/자료:
- Gemini 2.5 Flash / Flash Image 모델 페이지:  
  https://cloud.google.com/vertex-ai/generative-ai/docs/models/gemini/2-5-flash#image
- REST Reference: `projects.locations.publishers.models.generateContent`  
  https://cloud.google.com/vertex-ai/generative-ai/docs/reference/rest/v1/projects.locations.publishers.models/generateContent
- Vertex AI Studio 바로 체험(Flash Image Preview):  
  https://console.cloud.google.com/vertex-ai/studio/multimodal?model=gemini-2.5-flash-image-preview

모델 ID 요약:
- 텍스트/멀티모달(GA): `gemini-2.5-flash`
- 이미지 생성/편집(Preview, nano-banana): `gemini-2.5-flash-image-preview`


## 사전 준비

1) GCP 프로젝트
- 결제가 설정된 GCP 프로젝트가 있어야 합니다.
- Vertex AI API 사용 설정

2) gcloud 인증(로컬 개발/테스트)
```
gcloud auth application-default login
gcloud config set project YOUR_PROJECT_ID
```
- Application Default Credentials(ADC)로 서버 코드가 액세스 토큰을 가져옵니다.
- server.js는 PROJECT_ID를 환경변수 또는 ADC에서 자동 해석합니다.

3) Node 버전
- Node.js 18+ 권장


## 설치 및 실행

프로젝트 루트는 `vertex-gemini-web` 폴더입니다.

1) 의존성 설치 (이미 설치했다면 생략)
```
npm install
```

2) 환경변수 설정(선택)
- `.env.example`를 `.env`로 복사 후 값 채우기
  - `PROJECT_ID` (미설정 시 ADC에서 프로젝트 ID 자동 해석 시도)
  - `VERTEX_LOCATION` (기본: `us-central1`)
    - Flash Image Preview는 문서상 “Global” 가용으로 표기됩니다. 글로벌 엔드포인트를 사용하려면 `VERTEX_LOCATION=global` 로 설정하세요.
  - `VERTEX_TEXT_MODEL` / `VERTEX_IMAGE_MODEL` (미설정 시 기본값 사용)
```
cp .env.example .env   # Windows PowerShell: Copy-Item .env.example .env
```

3) 로컬 실행
```
npm run start
```
브라우저에서 http://localhost:3000 접속


## 사용 방법

- 상단 Config 카드에서 서버가 감지한 `Project/Location/Model`을 확인할 수 있습니다.
- 텍스트 탭
  - 프롬프트를 입력하고 “텍스트 생성” 클릭
  - 옵션(temperature/topP/maxOutputTokens/systemInstruction) 제공 가능
- 이미지 탭
  - 프롬프트 입력
  - 선택적으로 참조 이미지 업로드(편집/퓨전 등)
  - 응답 포맷(responseMimeType) 지정 가능: `image/png`, `image/jpeg`, `image/webp`

서버 라우트:
- `POST /api/generate-text`
  - body: `{ prompt, systemInstruction?, temperature?, topP?, maxOutputTokens?, modelId? }`
  - 기본 모델: `gemini-2.5-flash`
- `POST /api/generate-image`
  - body: `{ prompt, imageBase64?, imageMimeType?, responseMimeType?, temperature?, topP?, maxOutputTokens?, modelId? }`
  - 기본 모델: `gemini-2.5-flash-image-preview`
  - 이미지 업로드 시 data URL 또는 순수 base64를 지원합니다.
- `GET /api/config`
  - 서버에서 사용 중인 설정(프로젝트/리전/모델) 확인


## 엔드포인트 구성 참고

server.js는 REST 엔드포인트를 다음과 같이 구성합니다.
- 리전별: `https://{LOCATION}-aiplatform.googleapis.com`
- Global 사용 시: `https://aiplatform.googleapis.com`
- 최종 경로: `/v1/projects/{PROJECT_ID}/locations/{LOCATION}/publishers/google/models/{MODEL_ID}:generateContent`

지원 리전(요약):
- `gemini-2.5-flash`는 us-central1 등 다수 리전에서 제공
- `gemini-2.5-flash-image-preview`는 문서에 Global로 표기 (예: `.env`에서 `VERTEX_LOCATION=global`)


## 문제 해결(Troubleshooting)

- 401/403 인증 오류
  - `gcloud auth application-default login` 수행 여부 확인
  - `gcloud config set project YOUR_PROJECT_ID` 수행 여부 확인
  - 프로젝트에 Vertex AI API가 사용 설정되어 있는지 확인
- 404 또는 `MODEL_NOT_AVAILABLE`/`location mismatch`
  - 모델과 리전의 호환성 확인 (예: Flash Image Preview는 Global 권장)
  - `.env`에서 `VERTEX_LOCATION`을 `global` 또는 문서의 가용 리전으로 설정
- 응답에 이미지가 포함되지 않음
  - 응답 `candidates[].content.parts[]`에서 `inlineData` 유무 확인 (서버가 기본적으로 파싱)
  - `responseMimeType`를 지원 포맷으로 설정했는지 확인
- 속도/비용/할당량
  - https://cloud.google.com/vertex-ai/generative-ai/pricing
  - https://cloud.google.com/vertex-ai/generative-ai/docs/quotas


## 보안

- 브라우저에서 직접 Vertex AI 호출을 하지 않고, 서버에서 토큰을 사용해 안전하게 호출합니다.
- 로컬 테스트 용도로 설계되었으며, 서비스 배포 시에는 인증/권한/요금 보호를 위한 추가 보안 고려가 필요합니다.


## 선택: Cloud Run 배포 가이드(요약)

1) 컨테이너라이즈
```
gcloud builds submit --tag gcr.io/$PROJECT_ID/vertex-gemini-web
```

2) Cloud Run 배포 (리전은 서버의 LOCATION와 무관하게 앱 호스팅 리전)
```
gcloud run deploy vertex-gemini-web \
  --image gcr.io/$PROJECT_ID/vertex-gemini-web \
  --platform managed --allow-unauthenticated --region asia-northeast3
```

3) 환경변수 설정
- `VERTEX_LOCATION` / `VERTEX_TEXT_MODEL` / `VERTEX_IMAGE_MODEL` 등


## 라이선스

- 코드 샘플은 Apache-2.0 (Google Developers 사이트 정책 참고)
- 문서 내용은 CC BY 4.0 (공식 문서 각 섹션 하단 라이선스 참고)
