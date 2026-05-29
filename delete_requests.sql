-- 删除两条借用申请记录：BR-20260527-005 和 BR-20260522-004
-- 关联的 approval_records 会因外键级联自动删除

DELETE FROM borrow_requests 
WHERE request_number IN ('BR-20260527-005', 'BR-20260522-004');

-- 验证删除结果
SELECT request_number, status FROM borrow_requests 
WHERE request_number IN ('BR-20260527-005', 'BR-20260522-004');
