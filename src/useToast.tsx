import { useState, useCallback, useRef } from 'react';

export function useToast() {
  const [msg, setMsg] = useState('');
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const toast = useCallback((message: string) => {
    setMsg(message);
    setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 3200);
  }, []);

  const ToastEl = (
    <div className={`toast${show ? ' show' : ''}`}>{msg}</div>
  );

  return { toast, ToastEl };
}
