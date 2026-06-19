import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Mail } from "lucide-react";
import PageTransition from "../../components/PageTransition";
import AuthStepShell from "./AuthStepShell";
import { loadWalletAddress } from "../../services/browserSession";
import {
  getOtpSession,
  getWalletIdentity,
  requestEmailOtp,
  resetOtpSession,
  verifyEmailOtp,
} from "../../services/identityApi";

const RESEND_COOLDOWN_S = 45;
const MAX_VERIFY_ATTEMPTS = 5;

export default function VerifyEmail() {
  const navigate = useNavigate();
  const location = useLocation();
  const otpInputsRef = useRef([]);

  const walletAddress = useMemo(() => loadWalletAddress(), []);

  const [ui, setUi] = useState({
    email: "",
    otp: "",
    step: "EMAIL",
    cooldown: 0,
    attemptsLeft: MAX_VERIFY_ATTEMPTS,
  });

  const [status, setStatus] = useState({ type: "idle", msg: "" });
  const emailValidationMessage = validateEmail(ui.email);
  const isEmailValid = !emailValidationMessage;
  const isOtpValid = ui.otp.length === 6;

  useEffect(() => {
    if (!walletAddress) navigate("/auth/connect-wallet", { replace: true });
  }, [walletAddress, navigate]);

  useEffect(() => {
    let cancelled = false;

    async function loadIdentityState() {
      if (!walletAddress) return;
      try {
        if (location.state?.resetVerificationFlow) {
          await resetOtpSession(walletAddress).catch(() => {});
        }
        const [identity, session] = await Promise.all([
          getWalletIdentity(walletAddress),
          getOtpSession(walletAddress),
        ]);
        if (cancelled) return;
        if (identity?.isVerified) {
          navigate("/dashboard", { replace: true });
          return;
        }
        const remaining = session?.lastSentAt
          ? getRemainingCooldownSeconds(session.lastSentAt)
          : 0;
        setUi((prev) => ({
          ...prev,
          email: session?.email || identity?.email || "",
          otp: "",
          step: session?.email ? "OTP" : "EMAIL",
          cooldown: remaining,
          attemptsLeft:
            typeof session?.attemptsLeft === "number"
              ? session.attemptsLeft
              : MAX_VERIFY_ATTEMPTS,
        }));
      } catch {
        if (!cancelled) {
          setUi((prev) => ({
            ...prev,
            email: "",
            otp: "",
            step: "EMAIL",
            cooldown: 0,
            attemptsLeft: MAX_VERIFY_ATTEMPTS,
          }));
        }
      }
    }

    loadIdentityState();
    return () => {
      cancelled = true;
    };
  }, [location.state, walletAddress, navigate]);

  useEffect(() => {
    if (ui.cooldown <= 0) return;
    const t = setInterval(() => {
      setUi((prev) => ({ ...prev, cooldown: Math.max(0, prev.cooldown - 1) }));
    }, 1000);
    return () => clearInterval(t);
  }, [ui.cooldown]);

  useEffect(() => {
    if (ui.step !== "OTP") return;
    const t = setTimeout(() => {
      otpInputsRef.current[0]?.focus();
      otpInputsRef.current[0]?.select?.();
    }, 0);
    return () => clearTimeout(t);
  }, [ui.step]);

  const otpDigits = ui.otp.padEnd(6).slice(0, 6).split("");

  const handleSendCode = async () => {
    setStatus({ type: "idle", msg: "" });

    const emailError = validateEmail(ui.email);
    if (emailError) {
      setStatus({ type: "error", msg: emailError });
      return;
    }

    try {
      const result = await requestEmailOtp({
        walletAddress,
        email: ui.email,
      });
      setUi((prev) => ({
        ...prev,
        step: "OTP",
        otp: "",
        attemptsLeft:
          typeof result?.attemptsLeft === "number" ? result.attemptsLeft : MAX_VERIFY_ATTEMPTS,
        cooldown:
          typeof result?.cooldown === "number" ? result.cooldown : RESEND_COOLDOWN_S,
      }));
      setStatus({
        type: "success",
        msg: "Verification code sent. Check the backend console.",
      });
      navigate(location.pathname, {
        replace: true,
        state: null,
      });
    } catch (error) {
      const cooldown = Number(error?.payload?.cooldown || 0);
      if (cooldown > 0) {
        setUi((prev) => ({ ...prev, cooldown }));
        setStatus({
          type: "info",
          msg: `Please wait ${cooldown}s before resending a code.`,
        });
        return;
      }
      setStatus({
        type: "error",
        msg: String(error?.message || "Could not send verification code."),
      });
    }
  };

  const handleVerify = async () => {
    setStatus({ type: "idle", msg: "" });

    if (!ui.otp || ui.otp.length !== 6) {
      setStatus({ type: "error", msg: "Enter the 6-digit code." });
      return;
    }

    try {
      await verifyEmailOtp({ walletAddress, code: ui.otp });
      setStatus({ type: "success", msg: "Email verified successfully!" });
      setTimeout(() => {
        navigate("/dashboard", { replace: true });
      }, 350);
    } catch (error) {
      const attemptsLeft = error?.payload?.attemptsLeft;
      if (typeof attemptsLeft === "number") {
        setUi((prev) => ({ ...prev, attemptsLeft }));
      }
      const message = String(error?.message || "Could not verify code.");
      setStatus({ type: "error", msg: message });
      if (message.includes("No verification session found") || message.includes("Code expired")) {
        setUi((prev) => ({ ...prev, step: "EMAIL", otp: "" }));
      }
    }
  };

  const onOtpChange = (index, value) => {
    const digits = value.replace(/\D/g, "");
    if (digits.length > 1) {
      const next = ui.otp.padEnd(6).slice(0, 6).split("");
      digits
        .slice(0, 6 - index)
        .split("")
        .forEach((digit, offset) => {
          next[index + offset] = digit;
        });
      const merged = next.join("").trimEnd();
      setUi((prev) => ({ ...prev, otp: merged }));
      const nextFocusIndex = Math.min(index + digits.length, 5);
      otpInputsRef.current[nextFocusIndex]?.focus();
      return;
    }

    const digit = digits.slice(-1);
    const next = ui.otp.padEnd(6).slice(0, 6).split("");
    next[index] = digit;
    const merged = next.join("").trimEnd();
    setUi((prev) => ({ ...prev, otp: merged }));

    if (digit && index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }
  };

  const onOtpKeyDown = (index, e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleVerify();
      return;
    }

    if (e.key !== "Backspace") return;

    e.preventDefault();
    const next = ui.otp.padEnd(6).slice(0, 6).split("");

    if (otpDigits[index]) {
      next[index] = "";
      setUi((prev) => ({ ...prev, otp: next.join("").trimEnd() }));
      if (index > 0) {
        otpInputsRef.current[index - 1]?.focus();
        otpInputsRef.current[index - 1]?.select?.();
      }
      return;
    }

    if (index > 0) {
      next[index - 1] = "";
      setUi((prev) => ({ ...prev, otp: next.join("").trimEnd() }));
      otpInputsRef.current[index - 1]?.focus();
      otpInputsRef.current[index - 1]?.select?.();
    }
  };

  const onOtpPaste = (index, e) => {
    const pasted = e.clipboardData?.getData("text")?.replace(/\D/g, "") || "";
    if (!pasted) return;
    e.preventDefault();
    onOtpChange(index, pasted);
  };

  const handleResend = () => {
    if (ui.cooldown > 0) return;
    handleSendCode();
  };

  const changeEmail = async () => {
    setStatus({ type: "idle", msg: "" });
    setUi((prev) => ({
      ...prev,
      email: "",
      step: "EMAIL",
      otp: "",
      cooldown: 0,
      attemptsLeft: MAX_VERIFY_ATTEMPTS,
    }));
    await resetOtpSession(walletAddress).catch(() => {});
  };

  return (
    <PageTransition>
      <AuthStepShell step={2}>
        <div className="mx-auto max-w-xl rounded-2xl border border-[#d9dbe5] bg-[#f7f7fa] p-7">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-[#e9e2f7]">
            <Mail className="h-10 w-10 text-[#652ed1]" />
          </div>

          {ui.step === "EMAIL" ? (
            <>
              <h1 className="mt-7 text-center text-3xl font-semibold text-[#111322]">
                Verify Your Email
              </h1>
              <p className="mx-auto mt-3 max-w-md text-center text-base text-[#5f657d]">
                Link an email to your wallet for accountability.
              </p>

              <div className="mt-6 rounded-xl bg-[#ececf1] px-4 py-3 text-center">
                <div className="text-sm text-[#666c84]">Wallet</div>
                <div className="mt-1 font-mono text-base text-[#111322]">
                  {truncateAddress(walletAddress)}
                </div>
              </div>

              <input
                value={ui.email}
                onChange={(e) =>
                  setUi((prev) => ({ ...prev, email: e.target.value.trim() }))
                }
                placeholder="you@gmail.com"
                className="mt-4 w-full rounded-xl border border-[#d6d8e3] bg-white px-4 py-3 text-base outline-none focus:ring-2 focus:ring-[#652ed1]/20"
                autoComplete="email"
              />

              <button
                type="button"
                onClick={handleSendCode}
                disabled={!isEmailValid}
                className={[
                  "mt-4 w-full rounded-xl py-3 text-base font-semibold text-white transition",
                  isEmailValid
                    ? "bg-[#5a24b4] hover:bg-[#4b1f95]"
                    : "cursor-not-allowed bg-[#c9c3d8]",
                ].join(" ")}
              >
                Send Verification Code
              </button>
            </>
          ) : (
            <>
              <h1 className="mt-7 text-center text-3xl font-semibold text-[#111322]">
                Enter Verification Code
              </h1>
              <p className="mx-auto mt-3 max-w-md text-center text-base text-[#5f657d]">
                We sent a 6-digit code to {ui.email}. Enter the code to continue.
              </p>

              <div className="mt-7 flex items-center justify-center">
                <div className="grid grid-cols-6 overflow-hidden rounded-xl border border-[#d6d8e3]">
                  {otpDigits.map((d, idx) => (
                    <input
                      key={idx}
                      ref={(el) => {
                        otpInputsRef.current[idx] = el;
                      }}
                      value={d.trim()}
                      onChange={(e) => onOtpChange(idx, e.target.value)}
                      onKeyDown={(e) => onOtpKeyDown(idx, e)}
                      onPaste={(e) => onOtpPaste(idx, e)}
                      inputMode="numeric"
                      type="text"
                      autoComplete="off"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      name={`otp-digit-${idx + 1}`}
                      data-form-type="other"
                      className="h-12 w-10 border-r border-[#d6d8e3] bg-white text-center text-base outline-none last:border-r-0"
                    />
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={handleVerify}
                disabled={!isOtpValid}
                className={[
                  "mt-5 w-full rounded-xl py-3 text-base font-semibold text-white transition",
                  isOtpValid
                    ? "bg-[#5a24b4] hover:bg-[#4b1f95]"
                    : "cursor-not-allowed bg-[#c9c3d8]",
                ].join(" ")}
              >
                Verify Email
              </button>

              <button
                type="button"
                onClick={changeEmail}
                className="mt-4 w-full text-center text-sm text-[#5f657d] hover:underline"
              >
                Use a different email
              </button>
            </>
          )}

          {status.type !== "idle" ? (
            <div
              className={[
                "mt-4 rounded-xl px-4 py-3 text-sm",
                status.type === "success" ? "bg-green-50 text-green-800" : "",
                status.type === "error" ? "bg-red-50 text-red-800" : "",
                status.type === "info" ? "bg-purple-50 text-purple-800" : "",
              ].join(" ")}
            >
              {status.msg}
              {ui.step === "OTP" && ui.cooldown > 0 ? ` (${ui.cooldown}s)` : ""}
            </div>
          ) : null}

          {ui.step === "OTP" ? (
            <button
              type="button"
              onClick={handleResend}
              disabled={ui.cooldown > 0}
              className="mt-3 w-full text-center text-base text-[#652ed1] disabled:text-[#9ea3b8]"
            >
              {ui.cooldown > 0 ? `Resend in ${ui.cooldown}s` : "Resend code"}
            </button>
          ) : null}
        </div>
      </AuthStepShell>
    </PageTransition>
  );
}

function validateEmail(value) {
  if (!value) return "Email is required.";
  if (value.length < 6) return "Email must be at least 6 characters long.";
  if (value.length > 254) return "Email must be 254 characters or fewer.";
  if (/\s/.test(value)) return "Email cannot contain spaces.";

  const atCount = (value.match(/@/g) || []).length;
  if (atCount !== 1) return "Email must contain exactly one @ symbol.";

  const [localPart, domainPart] = value.split("@");
  if (!localPart || !domainPart) return "Email must include text before and after @.";
  if (localPart.length > 64) return "Email username is too long.";
  if (localPart.startsWith(".") || localPart.endsWith(".") || localPart.includes("..")) {
    return "Email username cannot start/end with a dot or contain consecutive dots.";
  }
  if (!/^[A-Za-z0-9._%+-]+$/.test(localPart)) {
    return "Email username contains invalid characters.";
  }

  if (domainPart.includes("..")) return "Email domain cannot contain consecutive dots.";
  if (!/^[A-Za-z0-9.-]+$/.test(domainPart)) {
    return "Email domain contains invalid characters.";
  }

  const domainLabels = domainPart.split(".");
  if (domainLabels.length < 2) return "Email domain must include a dot.";
  for (const label of domainLabels) {
    if (!label) return "Email domain has an empty section.";
    if (label.startsWith("-") || label.endsWith("-")) {
      return "Email domain sections cannot start or end with a hyphen.";
    }
  }
  if (domainLabels[domainLabels.length - 1].length < 2) {
    return "Email must have a valid domain extension (e.g. .com, .edu, .org).";
  }

  return "";
}

function getRemainingCooldownSeconds(lastSentAt) {
  if (!lastSentAt) return 0;
  const elapsed = Math.floor((Date.now() - lastSentAt) / 1000);
  return Math.max(0, RESEND_COOLDOWN_S - elapsed);
}

function truncateAddress(addr) {
  if (!addr) return "";
  if (addr.includes("...")) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}
