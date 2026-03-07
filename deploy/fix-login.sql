-- Fix login: ensure admin user is active and verify users table
UPDATE public.users SET active = true WHERE email = 'admin@rentfoxxy.com';
SELECT user_id, name, email, active FROM public.users WHERE email = 'admin@rentfoxxy.com';
