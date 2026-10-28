# Kế hoạch triển khai — English Image OCR

## Phạm vi

Website học tiếng Anh nhận folder Google Drive công khai, chọn ngẫu nhiên một ảnh, dùng Gemini API để chỉ hiển thị các từ và cụm từ tiếng Anh nhìn thấy trong ảnh—không hiện câu nguyên văn, IPA, cách phát âm, bản dịch hay giải thích. Mỗi mục nhiều từ được giữ nguyên như một cụm, không tách thành các chip/từ riêng. Model chính là `gemini-3.5-flash-lite`; chỉ khi model chính trả HTTP `429 RESOURCE_EXHAUSTED` do rate/quota mới thử `gemini-3.1-flash-lite` một lần. Danh sách giữ thứ tự xuất hiện và bỏ mục trùng lặp không phân biệt hoa/thường. Kết quả được lưu trong Supabase và dùng chung cho mọi người. Mỗi ảnh Drive có tối đa một hàng cache theo `drive_file_id`; cache chỉ dùng phiên bản vocabulary hiện tại và ghi lại model thực sự đã xử lý ảnh. Khóa Gemini và Supabase chỉ nằm trong biến môi trường backend, không xuất hiện trong giao diện, bundle trình duyệt, log công khai hay phản hồi API.

## Kiến trúc

- Dùng starter React + Express + TypeScript đã khởi tạo, với server được bật và database managed của WebDev tắt. Dữ liệu OCR dùng Supabase mà người dùng yêu cầu; không có user account hay phân vùng theo từng người.
- Trang React gửi folder ID/link tới endpoint Express. Backend chỉ chấp nhận ID folder hợp lệ, đọc trang nhúng công khai `drive.google.com/embeddedfolderview`, lấy danh sách ảnh và chọn ngẫu nhiên một ảnh. Danh sách được cache trong bộ nhớ server 5 phút, tối đa 20 folder; các request đồng thời cùng folder dùng chung lần tải. Không fetch URL tùy ý do client gửi, nhằm tránh SSRF. Cách đọc trang nhúng không phải API chính thức và có thể cần cập nhật nếu Google thay đổi HTML.
- Backend truy vấn Supabase theo `drive_file_id` trước khi gọi model. Chỉ chấp nhận cache tag `gemini-3.5-flash-lite-vocab-v2` hoặc `gemini-3.1-flash-lite-vocab-v2`; cache OCR.space, Gemini nguyên văn cũ và các kết quả `vocab-v1` đã tách cụm là miss. Với cache hit, server tải ảnh từ Drive và trả data URL; không đưa URL trực tiếp có Drive file ID vào phản hồi trình duyệt. Nếu cache miss, tải ảnh từ Drive và chuẩn bị ảnh: gửi trực tiếp PNG/JPEG/WebP hợp lệ ≤8 MB khi hướng ảnh bình thường; Sharp tự xoay EXIF và chuyển ảnh lớn/định dạng khác thành JPEG trong giới hạn. Gửi ảnh inline tới `generateContent` bằng key trong header `x-goog-api-key`.
- Prompt yêu cầu Gemini chỉ trả các từ/cụm từ tiếng Anh nhìn thấy được, một mục trên mỗi dòng; giữ nguyên cụm nhiều từ, không tách cụm thành từng chip. Không suy diễn, không lấy IPA/cách phát âm, câu đầy đủ, định nghĩa, bản dịch, nhãn hoặc nội dung ngôn ngữ khác. Hậu xử lý bỏ nhãn và mẫu IPA, chuẩn hóa token A–Z bên trong từng mục nhưng giữ khoảng trắng/cấu trúc cụm, giữ apostrophe/hyphen, bỏ mục lặp không phân biệt hoa/thường, giữ thứ tự xuất hiện đầu; nếu không còn mục thì trả thông báo phù hợp thay vì lưu kết quả rỗng.
- Gọi `gemini-3.5-flash-lite` trước. Khi HTTP status `429` (`RESOURCE_EXHAUSTED`, rate/quota) thì gọi `gemini-3.1-flash-lite` đúng một lần. Không fallback cho API key/quyền sai, request lỗi, model không tồn tại, HTTP 402 do prepay credit cạn hoặc lỗi khác. Nếu fallback cũng trả 429, báo giới hạn sử dụng; không gọi vòng lặp. Google áp dụng giới hạn theo project và từng model; fallback chỉ giúp nếu model 3.1 còn hạn mức, không vượt qua giới hạn chi tiêu chung của project.
- Cache Supabase lưu `drive_file_id` (primary key), `folder_id`, `file_name`, `image_url`, danh sách từ/cụm từ, model thực tế (`gemini-3.5-flash-lite-vocab-v2` hoặc `gemini-3.1-flash-lite-vocab-v2`), `created_at` và `updated_at`. Không lưu base64 ảnh trong Postgres; `image_url` trỏ tới file public trên Drive nhưng chỉ backend dùng.
- Migration `supabase/migrations/20261025000000_ocr_cache.sql` bật RLS, thu hồi quyền từ `PUBLIC`, `anon` và `authenticated`, chỉ cấp quyền cho `service_role`. Website backend dùng `SUPABASE_URL`, `SUPABASE_SECRET_KEY` và `GOOGLE_AI_STUDIO_API_KEY`; các key bí mật chỉ tồn tại server-side. URL được chuẩn hóa nếu giá trị đầu vào đã kèm `/rest/v1/`.
- Ứng dụng không tự tạo schema Supabase; người dùng cần chạy migration một lần trong Supabase SQL Editor. Sau khi migration và secrets có mặt, endpoint dùng `@supabase/supabase-js` để đọc/upsert.
- UI trình bày mỗi từ/cụm từ bằng thẻ học tương tác; mỗi thẻ có nút đánh dấu đã học và nút copy giữ nguyên từng mục trên một dòng. Không hiển thị đoạn văn gốc, bản dịch, giải thích hoặc IPA. UI hiển thị model đang dùng, bao gồm khi phải chuyển sang fallback 3.1, và trạng thái cache. Nếu cache chưa sẵn sàng, UI hiện cảnh báo chung và OCR vẫn tiếp tục; lỗi quota, key không hợp lệ, ảnh lỗi và không tìm thấy từ/cụm tiếng Anh được báo ngắn gọn, không lộ raw provider response hay credential. Unexpected backend exceptions chỉ được log bằng thông điệp chung, không log nguyên văn lỗi.
- Vòng lặp game hóa dùng coin thay XP: mỗi mục từ mới được đánh dấu học cộng 5 coin, hoàn thành mục tiêu ba mục cộng thêm 15 coin một lần mỗi ngày, level tăng mỗi 100 coin. Energy hiển thị tiến độ năng lượng ngày từ 0 đến 3 theo số mục đã học hôm nay; energy làm mới theo ngày tại chỗ, không trừ năng lượng để chặn đọc/OCR hoặc học thêm. Lưu coin và mục đã học hôm nay trong `localStorage`; khi đọc dữ liệu cũ, dùng số XP đã có làm số dư coin khởi đầu để không mất tiến độ. Không thêm tài khoản hay đồng bộ tiến độ cá nhân lên Supabase.

## Cấu trúc chính

- `client/src/pages/Home.tsx`: giao diện học tập mobile-first, header HUD có huy hiệu Wordpick/level, coin balance, energy ngày và icon game, ô nhập link folder, trạng thái OCR/cache, quest hằng ngày, thẻ học từ/cụm và nút copy giữ nguyên từng cụm.
- `client/src/lib/learningProgress.ts`: chuẩn hóa, tính và lưu coin/tiến độ học riêng trên thiết bị, tương thích số XP đã lưu trước đây; `learningProgress.test.ts` kiểm tra coin, thưởng quest, reset energy theo ngày và nạp dữ liệu cũ.
- Header tham chiếu trực tiếp ảnh coin mới nền trong suốt do GPT Image 2.5 tạo cùng icon energy tinh thể tia sét đang dùng; giữ nguyên URL Managed Storage. Mặt coin để trơn, phủ chữ W bằng CSS với Lilita One để đảm bảo kiểu chữ chính xác.
- `client/src/index.css`: bố cục responsive ưu tiên một cột và thao tác một tay trên mobile; header dùng huy hiệu W/level và counter coin/energy một hàng với backing đen 40% opacity bao cả icon trái lẫn lượng bên phải; giữ font Lilita One, viên số hơi vuông và badge cộng xanh; navbar full-width có Home nổi giữa, nút icon bevel và vùng safe area; desktop giữ bố cục rộng. Khung SOURCE IMAGE dùng tỷ lệ 2:3 và `object-fit: contain` để giữ trọn nội dung ảnh gốc.
- `client/public/manus-routes.json`: manifest cho route trang chủ `/`.
- `server/_core/index.ts`: đăng ký endpoint HTTP `/api/ocr/random`.
- `server/driveOcr.ts`: cache danh sách folder public, chọn ảnh, chuẩn bị ảnh, truy vấn cache, gọi Gemini primary/fallback, lọc vocabulary và log timing an toàn.
- `server/supabaseOcrCache.ts`: khởi tạo Supabase client server-side và cung cấp lookup/upsert theo Drive file ID và tập model được phép.
- `supabase/migrations/20261025000000_ocr_cache.sql`: bảng cache một hàng mỗi ảnh và quyền RLS.
- `sharp`, `@supabase/supabase-js`: chuẩn bị ảnh và truy cập Supabase.
- `plan.md`, `TODO.md`: kế hoạch và trạng thái các kết quả.

## Thiết kế

Ba hướng thị giác được cân nhắc (xác suất lấy mẫu nhỏ trong miền đuôi):

1. **Editorial study desk — 0.07:** trang học tập ấm áp như tạp chí từ vựng in.
2. **Neon language lab — 0.04:** phòng thí nghiệm ngôn ngữ tối, nhiều đèn neon.
3. **Quiet museum archive — 0.03:** kho lưu trữ tối giản, tông đơn sắc.

Chọn **Editorial study desk**.

- **Design Movement:** editorial typography đương đại pha với đồ dùng bàn học analog; navbar là lớp game HUD bóng bẩy theo ảnh tham chiếu của người dùng.
- **Core Principles:** mobile-first và thao tác một tay; tiến trình game hóa luôn rõ; nội dung từ vựng vẫn là trọng tâm; màu nhấn tiết chế trong phong cách editorial.
- **Color Philosophy:** nền giấy kem tạo cảm giác tập trung; mực than giữ độ tương phản; xanh cobalt là màu thương hiệu; header/navbar giữ plum-magenta và gold; từng resource counter dùng backing đen trong suốt 40% để gom icon và lượng vào một HUD rõ ràng, dấu cộng vẫn xanh cobalt.
- **Layout Paradigm:** trên mobile là luồng một cột gồm header HUD với huy hiệu W/level, coin balance và energy 0/3–3/3 theo hoạt động trong ngày; tiếp đến quest, chọn ảnh, thẻ từ và thanh game HUD full-width ở đáy; Home mặc định nổi ở giữa, Practice và Progress ở hai bên. Desktop mở rộng thành dashboard thoáng.
- **Signature Elements:** thẻ quest cobalt có thanh tiến độ; thẻ từ có nút nhận coin; header có coin không ngôi sao với chữ W Lilita One, icon coin/energy nằm trong backing đen 40% cùng hàng với lượng, badge cộng xanh ở góc dưới-phải và các nút bevel.
- **Interaction Philosophy:** mỗi từ/cụm học mới trong ngày cộng 5 coin một lần; hoàn thành mục tiêu 3 mục cộng thưởng 15 coin; energy tăng theo tiến độ ngày 0/3 đến 3/3 và làm mới hằng ngày, không giới hạn số lần đọc/học. Dữ liệu coin và tiến độ lưu cục bộ trên thiết bị, tách biệt cache OCR dùng chung. Chọn tab di chuyển trạng thái nổi bật sang đúng nút nhưng luôn giữ liên kết Home/Practice/Progress có chức năng.
- **Animation:** nút nav nảy/lún rất nhẹ như nút game khi chạm; tab active chuyển vị trí và sáng lên nhanh; thanh quest tăng mượt, hiệu ứng chúc mừng tiết chế; tôn trọng `prefers-reduced-motion`.
- **Typography System:** `DM Sans` cho giao diện và đoạn văn, `DM Serif Display` cho tiêu đề bài học, `Lilita One` cho số liệu/nhãn trong HUD và chữ W trên coin; phân cấp bằng kích thước và độ đậm.
- **Brand Essence:** công cụ biến ảnh tiếng Anh thành bài đọc tức thì; tính cách gần gũi, sắc sảo, hữu ích.
- **Brand Voice:** tiêu đề ngắn, thân thiện; CTA trực tiếp, khích lệ. Ví dụ: “Chọn ảnh, mở khóa từ mới.” và “Học 3 từ hôm nay để nhận thưởng.”
- **Wordmark & Logo:** chữ `Wordpick` đi cùng dấu ngoặc vuông mở như khung trích văn bản.
- **Signature Brand Color:** cobalt `#3157D5`.

## Giới hạn và thao tác cần có

Folder công khai của người dùng hiện liệt kê 1.974 ảnh. URL xem trực tiếp của file trong folder public trả về ảnh WebP, phù hợp để hiển thị ảnh cache mà không lưu base64 trong bảng. Baseline tải HTML danh sách Drive là 1,624,728 byte và khoảng 6.1 giây; lần đầu, sau khi hết TTL 5 phút hoặc sau khi server khởi động lại vẫn phải tải lại. Ảnh PNG/JPEG/WebP nhỏ được gửi trực tiếp tới Gemini; ảnh lớn, có EXIF rotation hoặc định dạng khác cần qua Sharp. Folder private cần Google OAuth nếu hỗ trợ về sau.

Gemini API key `GOOGLE_AI_STUDIO_API_KEY` và Supabase server secret đã được lưu qua WebDev. Bảng `public.ocr_cache` đã được tạo trong Supabase, bật RLS và chỉ cấp quyền cho backend. Kiểm tra end-to-end xác nhận lượt OCR đầu lưu thành công; yêu cầu lặp lại cùng ảnh trả cache hit và không gọi Gemini lại.

## Tài liệu Supabase

- [API keys](https://supabase.com/docs/guides/api/api-keys) — publishable dùng cho thành phần public; secret key dành cho backend và bypass RLS.
- [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) — bật RLS, thu hồi grants client và chỉ cấp quyền cần thiết.
- [JavaScript upsert](https://supabase.com/docs/reference/javascript/upsert) — upsert theo khóa unique.
- [JavaScript initialization](https://supabase.com/docs/reference/javascript/initializing) — khởi tạo client server-side với session persistence tắt.

## Tài liệu Gemini

- [Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite) — model ID ổn định `gemini-3.5-flash-lite`, input ảnh và output văn bản.
- [Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite) — model ID ổn định `gemini-3.1-flash-lite`, input ảnh và output văn bản.
- [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits) — giới hạn theo project/model; vượt hạn mức trả 429 `RESOURCE_EXHAUSTED`.
- [GenerateContent API errors](https://ai.google.dev/gemini-api/docs/generate-content/api-errors) — mô tả 429 rate/quota và 402 prepay-credit exhaustion.
