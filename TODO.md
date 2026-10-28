# TODO

## 1. Kết nối thư mục Drive và chọn ảnh ngẫu nhiên
- [x] Website nhận link thư mục Google Drive do người dùng cung cấp.
- [x] Website đọc danh sách ảnh của folder công khai và chọn ngẫu nhiên một ảnh hợp lệ.
- [x] Người dùng có thể yêu cầu chọn một ảnh khác.
- [x] Website chỉ đọc folder public; không giả định link cấp quyền cho folder private.

## 2. Quét từ vựng tiếng Anh bằng Gemini
- [x] Dùng `GOOGLE_AI_STUDIO_API_KEY` đã lưu qua WebDev secrets; key chỉ được backend đọc, không xuất hiện trong client bundle, source code, log, URL hoặc phản hồi API.
- [x] Gửi ảnh tới model ổn định `gemini-3.5-flash-lite` trước; yêu cầu chỉ lấy từ vựng tiếng Anh nhìn thấy trong ảnh, bỏ câu nguyên văn, IPA, cách phát âm, định nghĩa, bản dịch và từ không phải tiếng Anh; nếu là cụm từ thì giữ nguyên cụm đó như một mục.
- [x] Chỉ khi request model 3.5 trả HTTP `429 RESOURCE_EXHAUSTED` do rate/quota thì gọi `gemini-3.1-flash-lite` đúng một lần cho cùng ảnh. Không dùng fallback cho lỗi API key/quyền, request sai, HTTP 402 do credit thanh toán cạn, hoặc lỗi khác; nếu model 3.1 cũng chạm quota thì trả thông báo giới hạn rõ ràng. Đã mô phỏng các nhánh quota/fallback và lỗi 403.
- [x] Hậu xử lý kết quả thành các mục A–Z, giữ apostrophe/hyphen hợp lệ và khoảng trắng trong cụm; giữ thứ tự xuất hiện đầu, bỏ mục trùng không phân biệt hoa/thường, bỏ IPA; báo 422 thân thiện nếu không có mục tiếng Anh.
- [x] Nếu ảnh có cụm từ nhiều từ, hiển thị cả cụm thành một chip/mục và giữ nguyên cụm đó trong nội dung copy; không tách cụm thành các từ riêng lẻ. Đã kiểm tra mock pipeline giữ cụm `look after` và `a piece of cake` mỗi cụm một dòng, đồng thời chỉ khử trùng lặp nguyên cụm.
- [x] Hiển thị danh sách từ, cho phép copy, giữ ảnh đã chọn và trạng thái cache; UI nêu model 3.5 cùng fallback 3.1 khi quota, không hiển thị IPA, bản dịch hay giải thích.
- [x] Khi cache hit, backend tải ảnh và trả data URL, không gửi URL Drive chứa file ID cho trình duyệt; lỗi bất ngờ chỉ được log bằng thông điệp chung.
- [x] Log model được dùng và thời gian từng request/fallback nhưng không ghi API key hoặc OCR text; xác minh nhánh primary success, fallback 429, fallback success và quota của cả hai bằng mock.
- [x] Kiểm tra một lần end-to-end qua Preview với key đã có; trả HTTP 200, dùng Gemini 3.5 Flash-Lite và nhận 10 từ. Chỉ in trạng thái/model/số từ, không in key hay OCR text.

## 3. Thiết kế và cấu hình website
- [x] Hoàn thiện giao diện responsive cho màn hình desktop và điện thoại.
- [x] Khung SOURCE IMAGE hiển thị tỷ lệ dọc 2:3 thay cho 1:1; ảnh gốc được chứa trọn vẹn, không bị cắt.
- [x] Xóa khỏi hero các dòng “LEARN FROM WHAT YOU SEE”, “See it. Read it. Learn it.” và “Một tấm ảnh có thể mở ra cả một bài học. Chọn ngẫu nhiên ảnh từ Drive để tìm từ và cụm từ tiếng Anh, rồi học theo cách của bạn.”; giữ các nội dung hero còn lại và thu gọn khoảng trống phát sinh.
- [x] Thiết kế luồng mobile một cột, không tràn ngang ở chiều rộng 320px trở lên; nút chạm chính tối thiểu 44px và thanh điều hướng dưới có các liên kết hoạt động tới Home, Practice và Progress. Desktop vẫn giữ bố cục responsive.
- [x] Hiển thị quest hằng ngày “Practice 3 words”; mỗi từ/cụm từ mới được đánh dấu học cộng 5 coin tối đa một lần trong ngày; học đủ 3 mục trong ngày cộng một lần thưởng 15 coin; level tăng mỗi 100 coin. Thay các chỉ số game XP/streak bằng coin và energy.
- [x] Hiển thị energy ngày từ 0/3 đến 3/3 theo số mục đã học hôm nay; làm mới energy theo ngày tại chỗ, không tiêu hao hoặc chặn OCR và việc học thêm. Mỗi mục OCR vẫn có thao tác đánh dấu đã học; lưu coin và danh sách mục học hôm nay trong localStorage trên thiết bị, không đồng bộ tiến độ cá nhân lên Supabase. Khi đọc dữ liệu local cũ, giữ số dư bằng cách dùng XP đã lưu trước đây làm số coin khởi đầu.
- [x] Thiết kế lại navbar mobile thành dock game dạng capsule nổi trên safe area; giữ các liên kết hoạt động Home, Practice và Progress, trạng thái tab đang chọn rõ ràng, badge level ở Progress, vùng chạm tối thiểu 44px và focus-visible; navbar ẩn ở desktop.
- [x] Thiết kế navbar mobile theo ảnh tham chiếu: thanh game full-width tông plum/magenta, nút icon bóng có viền gold; Home ở giữa và nổi cao mặc định, Practice bên trái, Progress bên phải; khi chọn tab, trạng thái nổi bật theo tab đó và các anchor hiện có vẫn hoạt động. Giữ safe-area, focus-visible, vùng chạm tối thiểu 44px và ẩn navbar trên desktop; không thêm tab không có chức năng.
- [x] Thiết kế HUD coin/energy trên cùng một hàng với nền đen `40%` opacity bao trọn cả icon và số lượng; icon nằm bên trái bên trong nền, số lượng ở bên phải. Giữ viên số bo hơi vuông/chỉ chứa lượng, Lilita One, aria-label và dấu “+” xanh ở góc dưới-phải; nền phải là một backing chung chứ không để icon đứng ngoài. Giữ dải plum/magenta, huy hiệu W/level và liên kết; vừa viewport 320px trở lên và desktop.
- [x] Thiết kế lại icon coin bằng GPT Image 2.5: đồng vàng không ngôi sao, mặt trơn để phủ chữ W chuẩn Lilita One; giữ icon energy hiện có; nền icon xám nhạt và dấu cộng xanh ở góc dưới bên phải phải hiển thị đúng trong HUD.
- [x] Cung cấp `/manus-routes.json` với route trang chủ `/`.

## 4. Cache OCR Supabase dùng chung cho mọi người
- [x] Tạo `public.ocr_cache` với `drive_file_id` làm primary key/unique key; mỗi ảnh Drive chỉ có một hàng lưu tên file, folder, link ảnh public, từ vựng, model và thời điểm cập nhật.
- [x] Áp dụng cấu hình RLS trong migration: bật RLS, thu hồi quyền từ `PUBLIC`, `anon` và `authenticated`; chỉ backend server dùng Supabase secret key để đọc và ghi cache.
- [x] Cấu hình `SUPABASE_SECRET_KEY` qua WebDev secrets; secret chỉ dùng phía server, không có trong client bundle, source hay log.
- [x] Chỉ dùng cache row nếu model là `gemini-3.5-flash-lite-vocab-v2` hoặc `gemini-3.1-flash-lite-vocab-v2`; cache OCR.space/Gemini raw-text cũ và các hàng `vocab-v1` đã tách cụm là miss. Lưu tag đúng với model thực sự trả kết quả để các user có thể dùng chung khi bảng sẵn sàng. Đã kiểm tra hành vi model cache tag bằng mock; sau khi tạo bảng thật, lượt OCR đầu lưu thành công và lượt lặp lại cùng ảnh trả cache hit.
- [x] Hiển thị rõ kết quả được đọc từ cache hay vừa OCR và lưu mới; khi cache chưa sẵn sàng, hiện cảnh báo chung.
- [x] Chạy migration SQL một lần trong Supabase SQL Editor; xác nhận lookup/upsert Gemini hoạt động sau khi schema và secrets sẵn sàng.

## 5. Giảm độ trễ và đo thời gian xử lý
- [x] Cache danh sách ảnh của mỗi folder public trong 5 phút trên server; gộp các request đồng thời cùng folder, giới hạn tối đa 20 folder trong cache.
- [x] Giữ fast path PNG/JPEG/WebP hợp lệ ≤8 MB; dùng Sharp để xoay EXIF hoặc chuẩn hóa ảnh lớn/định dạng khác, tránh upload ảnh chất lượng thấp không cần thiết.
- [x] Ghi riêng thời gian tải ảnh, chuẩn bị ảnh, Gemini primary, Gemini fallback (nếu dùng), lookup/save cache và tổng thời gian; log không chứa folder ID, tên file, OCR text hoặc API key.
- [x] Kiểm tra mô phỏng xác nhận lượt tiếp theo cùng folder dùng danh sách cache trong TTL; lần đầu hoặc sau khi hết hạn vẫn cần lấy danh sách từ Drive.
