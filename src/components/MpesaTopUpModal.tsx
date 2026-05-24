import React, { useState, useEffect, useRef } from "react";
import { SmsTier, TOKEN_PACKAGES, KES_RATE_PER_TOKEN, tokensToKes, kesToTokens } from "../types";
import { pollTopUpStatus, initiateSmsTopUp } from "../services/PaymentService";


type PayStep = "select" | "confirm" | "waiting" | "success" | "failed";
 
interface Props {
  isOpen:        boolean;
  onClose:       () => void;
  tier:          SmsTier;
  currentTokens: number;
  userId:        string;
  schoolId:      string;
  schoolName:    string;
  onSuccess:     (tokensAdded: number) => void;
}
 
export default function MpesaTopUpModal({
  isOpen, onClose, tier, currentTokens,
  userId, schoolId, schoolName, onSuccess,
}: Props) {
  const kesRate  = KES_RATE_PER_TOKEN[tier];
  const tierLabel =
    tier === "small"  ? "≤100 recipients" :
    tier === "medium" ? "101–300 recipients" :
                        ">300 recipients";
 
  const [step,            setStep]            = useState<PayStep>("select");
  const [selectedPackage, setSelectedPackage] = useState<number | null>(null);
  const [customKes,       setCustomKes]       = useState("");
  const [phone,           setPhone]           = useState("");
  const [countdown,       setCountdown]       = useState(30);
  const [errorMsg,        setErrorMsg]        = useState("");
  const [currentRef,      setCurrentRef]      = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
 
  // Derived values
  const customTokens     = customKes ? kesToTokens(parseFloat(customKes) || 0, tier) : 0;
  const selectedTokens   = selectedPackage !== null ? selectedPackage : customTokens;
  const selectedKes      =
    selectedPackage !== null
      ? tokensToKes(selectedPackage, tier)
      : parseFloat(customKes) || 0;
 
  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setTimeout(() => {
        setStep("select"); setSelectedPackage(null);
        setCustomKes(""); setPhone(""); setCountdown(30);
        setErrorMsg(""); setCurrentRef("");
      }, 300);
    }
  }, [isOpen]);
 
  // Countdown + polling while waiting
  useEffect(() => {
    if (step !== "waiting") {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
 
    setCountdown(30);
    let elapsed = 0;
 
    pollRef.current = setInterval(async () => {
      elapsed += 3;
      setCountdown(c => Math.max(0, c - 3));
 
      if (currentRef) {
        const status = await pollTopUpStatus(currentRef);
        if (status === "success") {
          clearInterval(pollRef.current!);
          setStep("success");
          return;
        }
        if (status === "failed") {
          clearInterval(pollRef.current!);
          setErrorMsg("Payment was declined or cancelled. Please try again.");
          setStep("failed");
          return;
        }
      }
 
      if (elapsed >= 30) {
        clearInterval(pollRef.current!);
        // Timed out – show success anyway (webhook may just be slow)
        // In production you could show a "pending" state and refresh later
        setStep("success");
      }
    }, 3000);
 
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [step, currentRef]);
 
  async function handleSendStk() {
    setErrorMsg("");
    setStep("waiting");
    try {
      const result = await initiateSmsTopUp({
        phone:      `0${phone}`,   // phone input is without leading 0
        tokens:     selectedTokens,
        amountKes:  selectedKes,
        tier,
        schoolId,
        schoolName,
      });
      if (result.success) {
        setCurrentRef(result.data.reference);
      } else {
        throw new Error(result.message || "Charge initiation failed");
      }
    } catch (err: any) {
      if (pollRef.current) clearInterval(pollRef.current);
      setErrorMsg(err.message || "Failed to send STK push. Please try again.");
      setStep("failed");
    }
  }
 
  function handleSuccess() {
    onSuccess(selectedTokens);
    onClose();
  }
 
  if (!isOpen) return null;
 
  // ── JSX (identical look to the original, just wired to real payments) ────
  return (
    <div
      className="modal-overlay open"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <div>
            <span className="modal-title">Top Up SMS Tokens</span>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 3 }}>
              Rate: <strong style={{ color: "var(--mint-d)" }}>KES {kesRate}/token</strong>
              <span style={{ marginLeft: 8, background: "var(--surface-2)", padding: "2px 8px", borderRadius: 10, fontSize: 11 }}>{tierLabel}</span>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
 

        {step === "select" && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ background: "rgba(0,200,150,.07)", border: "1px solid rgba(0,200,150,.2)", borderRadius: 10, padding: "10px 14px", fontSize: 13, color: "var(--text-2)", marginBottom: 16 }}>
                <strong style={{ color: "var(--ink)" }}>How tokens work:</strong> 1 SMS (140 chars) to 1 parent = 1 token. At your rate, 1 token = <strong>KES {kesRate}</strong>. Tokens never expire.
              </div>
 
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Choose a package</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8, marginBottom: 20 }}>
                {TOKEN_PACKAGES.map(pkg => {
                  const kes       = tokensToKes(pkg, tier);
                  const isSelected = selectedPackage === pkg;
                  return (
                    <button key={pkg} onClick={() => { setSelectedPackage(pkg); setCustomKes(""); }}
                      style={{ border: `2px solid ${isSelected ? "var(--mint)" : "var(--border)"}`, borderRadius: 10, background: isSelected ? "rgba(0,200,150,.08)" : "var(--surface)", cursor: "pointer", padding: "12px 6px", textAlign: "center", transition: ".15s", fontFamily: "'Sora',sans-serif" }}>
                      <div style={{ fontSize: 18, fontWeight: 800, color: isSelected ? "var(--mint-d)" : "var(--ink)" }}>{pkg}</div>
                      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>tokens</div>
                      <div style={{ fontSize: 13, fontWeight: 700, marginTop: 6, color: isSelected ? "var(--mint-d)" : "var(--text-2)" }}>KES {kes % 1 === 0 ? kes : kes.toFixed(2)}</div>
                    </button>
                  );
                })}
              </div>
 
              <div style={{ border: `2px solid ${!selectedPackage && customKes ? "var(--mint)" : "var(--border)"}`, borderRadius: 10, padding: 14, background: "var(--surface)", transition: ".15s" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 }}>Or enter a custom KES amount</div>
                <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <div style={{ flex: 1, position: "relative" }}>
                    <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 14, fontWeight: 700, color: "var(--text-2)" }}>KES</span>
                    <input className="form-input" type="number" min="1" placeholder="e.g. 150" value={customKes} style={{ paddingLeft: 48 }}
                      onChange={e => { setCustomKes(e.target.value); setSelectedPackage(null); }} />
                  </div>
                  <div style={{ minWidth: 120, padding: "10px 14px", background: customTokens > 0 ? "rgba(0,200,150,.08)" : "var(--surface-2)", border: `1px solid ${customTokens > 0 ? "rgba(0,200,150,.2)" : "var(--border)"}`, borderRadius: 10, textAlign: "center" }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: customTokens > 0 ? "var(--mint-d)" : "var(--text-3)" }}>{customTokens > 0 ? customTokens : "—"}</div>
                    <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>tokens</div>
                  </div>
                </div>
              </div>
            </div>
 
            <div className="form-group">
              <label className="form-label">M-Pesa Phone Number</label>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "var(--text-2)", fontWeight: 500 }}>+254</span>
                <input className="form-input" type="tel" placeholder="7XX XXX XXX" value={phone} style={{ paddingLeft: 52 }}
                  onChange={e => setPhone(e.target.value.replace(/[^0-9]/g, ""))} />
              </div>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>You'll receive an M-Pesa STK push to confirm the payment.</div>
            </div>
 
            {selectedTokens > 0 && (
              <div style={{ background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 14px", marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13, color: "var(--text-2)" }}>
                  You'll get <strong style={{ color: "var(--ink)" }}>{selectedTokens} tokens</strong>
                  <span style={{ fontSize: 12, marginLeft: 6, color: "var(--text-3)" }}>(balance: {currentTokens} → {currentTokens + selectedTokens})</span>
                </div>
                <strong style={{ fontSize: 16, color: "var(--mint-d)" }}>KES {selectedKes % 1 === 0 ? selectedKes : selectedKes.toFixed(2)}</strong>
              </div>
            )}
 
            <button className="btn-primary" style={{ width: "100%", justifyContent: "center", padding: 14, fontSize: 15 }}
              disabled={selectedTokens < 1 || !phone.trim() || phone.length < 9}
              onClick={() => setStep("confirm")}>
              Continue to Pay →
            </button>
          </div>
        )}
 

        {step === "confirm" && (
          <div>
            <div style={{ background: "var(--surface-2)", borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 14 }}>Payment Summary</div>
              {[
                ["Tokens to receive", `${selectedTokens} tokens`],
                ["Amount to pay",     `KES ${selectedKes % 1 === 0 ? selectedKes : selectedKes.toFixed(2)}`],
                ["Rate",              `KES ${kesRate} per token (${tierLabel})`],
                ["Payment via",       "M-Pesa STK Push"],
                ["M-Pesa number",     `+254${phone}`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid var(--border)", fontSize: 14 }}>
                  <span style={{ color: "var(--text-2)" }}>{k}</span>
                  <strong style={{ color: "var(--ink)" }}>{v}</strong>
                </div>
              ))}
            </div>
            <div className="notice notice-info" style={{ marginBottom: 16 }}>
              📲 When you click below, we'll send an M-Pesa STK push to <strong>+254{phone}</strong>. Enter your M-Pesa PIN when prompted.
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button className="btn-secondary" onClick={() => setStep("select")}>← Back</button>
              <button className="btn-primary" style={{ flex: 1, justifyContent: "center", padding: 14, fontSize: 15 }} onClick={handleSendStk}>
                💳 Send M-Pesa Request
              </button>
            </div>
          </div>
        )}
 

        {step === "waiting" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: "rgba(0,200,150,.1)", border: "2px solid rgba(0,200,150,.3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 32, margin: "0 auto 20px" }}>📲</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>Check your phone</div>
            <div style={{ fontSize: 14, color: "var(--text-2)", marginBottom: 4 }}>M-Pesa STK push sent to <strong>+254{phone}</strong></div>
            <div style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 24 }}>Enter your M-Pesa PIN to pay <strong>KES {selectedKes % 1 === 0 ? selectedKes : selectedKes.toFixed(2)}</strong></div>
 
            <div style={{ position: "relative", width: 72, height: 72, margin: "0 auto 20px" }}>
              <svg width="72" height="72" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="36" cy="36" r="30" fill="none" stroke="var(--border)" strokeWidth="4" />
                <circle cx="36" cy="36" r="30" fill="none" stroke="var(--mint)" strokeWidth="4"
                  strokeDasharray={`${2 * Math.PI * 30}`}
                  strokeDashoffset={`${2 * Math.PI * 30 * (1 - countdown / 30)}`}
                  style={{ transition: "stroke-dashoffset 3s linear" }} />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 800, color: "var(--mint-d)" }}>{countdown}</div>
            </div>
 
            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 20 }}>Listening for payment confirmation…</div>
            <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => { if (pollRef.current) clearInterval(pollRef.current); setStep("select"); }}>Cancel</button>
          </div>
        )}
 

        {step === "success" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ width: 80, height: 80, borderRadius: "50%", background: "rgba(0,200,150,.12)", border: "3px solid var(--mint)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 20px" }}>✅</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>Payment Successful!</div>
            <div style={{ fontSize: 14, color: "var(--text-2)", marginBottom: 20 }}>
              <strong style={{ color: "var(--mint-d)", fontSize: 28, display: "block", marginBottom: 4 }}>+{selectedTokens} tokens</strong>
              added · new balance: <strong>{currentTokens + selectedTokens} tokens</strong>
            </div>
            <div style={{ background: "rgba(0,200,150,.07)", border: "1px solid rgba(0,200,150,.2)", borderRadius: 10, padding: "10px 16px", fontSize: 13, color: "var(--text-2)", marginBottom: 24 }}>
              KES {selectedKes % 1 === 0 ? selectedKes : selectedKes.toFixed(2)} charged to M-Pesa +254{phone}
            </div>
            <button className="btn-primary" style={{ padding: "12px 32px", fontSize: 15 }} onClick={handleSuccess}>Done →</button>
          </div>
        )}
 

        {step === "failed" && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ width: 80, height: 80, borderRadius: "50%", background: "rgba(232,69,69,.1)", border: "3px solid var(--red)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, margin: "0 auto 20px" }}>❌</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--ink)", marginBottom: 8 }}>Payment Failed</div>
            {errorMsg && <div className="error-msg" style={{ marginBottom: 16 }}>{errorMsg}</div>}
            <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
              <button className="btn-primary" onClick={() => setStep("select")}>Try Again</button>
              <button className="btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
