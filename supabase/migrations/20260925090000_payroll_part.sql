-- Payroll is a part of its own, like the rest: employees, pay runs and the
-- employer's payday filing details. Adding a value to the enum is all it takes;
-- save_part and the policies take any part the type allows.
alter type public.book_part add value if not exists 'payroll';
