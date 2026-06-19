import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, FileText, Upload, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  loadTokenomicsState,
  refreshWalletBalanceFromChain,
  SUBMISSION_FEE_DST,
} from "./tokenomicsStore";
import { saveSubmissionMetadata } from "./submissionMetadataStore";
import { upsertCanonicalReviewSession } from "./reviewWorkspace/sessionStore";
import { getWalletAddress } from "../utils";
import { reserveSubmissionFeeOnChain } from "../../../services/protocolVault";
import { submitPaperOnChain } from "../../../services/paperRegistry";
import { createSubmissionArtifacts } from "../../../services/publicationArtifactsApi";
import { formatWalletActionError } from "../../../services/walletError";
import { appendAuditEvent } from "./auditLogStore";
import TabHeader from "../../../components/feedback/TabHeader";
import TabState from "../../../components/feedback/TabState";
import { useToast } from "../../../components/feedback/ToastProvider";

const researchFields = [
  "Computer Science",
  "Cryptography",
  "Economics",
  "Data Science",
  "Security",
  "Distributed Systems",
  "Networking",
  "Formal Methods",
  "Political Science",
];
const REVIEW_WINDOW_DAYS = 21;
const REVIEWER_MATCH_BUFFER_DAYS = {
  low: 7,
  medium: 8,
  high: 10,
};
const UPLOAD_DRAFT_KEY = "uploadPaperDraft";
const uploadFileDrafts = new Map();

function StepIndicator({ currentStep }) {
  const steps = ["Details", "Upload", "Preview", "Done"];

  return (
    <div className="mb-6 flex items-center gap-2">
      {steps.map((label, idx) => {
        const stepNumber = idx + 1;
        const done = currentStep > stepNumber;
        const active = currentStep === stepNumber;
        return (
          <div key={label} className="flex items-center gap-2">
            <div
              className={[
                "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold",
                done || active
                  ? "bg-[#6828ce] text-white"
                  : "bg-[#ececf1] text-[#6f748e]",
              ].join(" ")}
            >
              {done ? <Check className="h-4 w-4" /> : stepNumber}
            </div>
            <span
              className={[
                "text-sm",
                active ? "font-semibold text-[#111322]" : "text-[#666c84]",
              ].join(" ")}
            >
              {label}
            </span>
            {idx < steps.length - 1 ? <div className="h-px w-6 bg-[#d8dbe5]" /> : null}
          </div>
        );
      })}
    </div>
  );
}

export default function UploadTab({ onWalletBalanceChange, isLoading = false, error = "" }) {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const wallet = getWalletAddress();
  const draft = useMemo(() => loadUploadDraft(wallet), [wallet]);

  const [step, setStep] = useState(draft.step);
  const [title, setTitle] = useState(draft.title);
  const [abstract, setAbstract] = useState(draft.abstract);
  const [field, setField] = useState(draft.field);
  const [keywordInput, setKeywordInput] = useState(draft.keywordInput);
  const [keywords, setKeywords] = useState(draft.keywords);
  const [collaboratorInput, setCollaboratorInput] = useState(draft.collaboratorInput);
  const [collaborators, setCollaborators] = useState(draft.collaborators);
  const [aiDisclosureChoice, setAiDisclosureChoice] = useState(draft.aiDisclosureChoice);
  const [aiDisclosureDetails, setAiDisclosureDetails] = useState(draft.aiDisclosureDetails);
  const [fileName, setFileName] = useState(draft.fileName);
  const [selectedFile, setSelectedFile] = useState(() => loadUploadFileDraft(wallet));
  const [validationError, setValidationError] = useState("");
  const [tokenomicsState, setTokenomicsState] = useState(() => loadTokenomicsState());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStage, setSubmitStage] = useState("");
  const [publishFeeBreakdown, setPublishFeeBreakdown] = useState(draft.publishFeeBreakdown);
  const effectiveSubmissionFee = SUBMISSION_FEE_DST;
  const reviewerPoolFeeShare = useMemo(() => Number(effectiveSubmissionFee) * 0.75, [effectiveSubmissionFee]);
  const perReviewerReward = useMemo(() => Number(reviewerPoolFeeShare) / 3, [reviewerPoolFeeShare]);
  const gasFeeShare = useMemo(() => Number(effectiveSubmissionFee) * 0.25, [effectiveSubmissionFee]);
  const reviewPlan = useMemo(
    () =>
      computeReviewPlan({
        title,
        abstract,
        field,
        keywords,
        collaborators,
        aiDisclosureChoice,
        aiDisclosureDetails,
      }),
    [title, abstract, field, keywords, collaborators, aiDisclosureChoice, aiDisclosureDetails]
  );
  const reviewDeadline = reviewPlan.reviewDeadline;

  useEffect(() => {
    if (typeof onWalletBalanceChange === "function") {
      onWalletBalanceChange(tokenomicsState.walletBalance);
    }
  }, [onWalletBalanceChange, tokenomicsState.walletBalance]);

  useEffect(() => {
    let cancelled = false;
    async function syncWalletBalance() {
      if (!wallet) return;
      try {
        const nextWalletBalance = await refreshWalletBalanceFromChain();
        if (!cancelled) {
          setTokenomicsState((prev) => ({ ...prev, walletBalance: nextWalletBalance }));
        }
      } catch {
        // Keep the cached balance if the chain refresh fails.
      }
    }
    syncWalletBalance();
    return () => {
      cancelled = true;
    };
  }, [wallet]);

  useEffect(() => {
    setStep(draft.step);
    setTitle(draft.title);
    setAbstract(draft.abstract);
    setField(draft.field);
    setKeywordInput(draft.keywordInput);
    setKeywords(draft.keywords);
    setCollaboratorInput(draft.collaboratorInput);
    setCollaborators(draft.collaborators);
    setAiDisclosureChoice(draft.aiDisclosureChoice);
    setAiDisclosureDetails(draft.aiDisclosureDetails);
    setFileName(draft.fileName);
    setSelectedFile(loadUploadFileDraft(wallet));
    setPublishFeeBreakdown(draft.publishFeeBreakdown);
    setValidationError("");
  }, [draft]);

  useEffect(() => {
    persistUploadDraft(wallet, {
      step,
      title,
      abstract,
      field,
      keywordInput,
      keywords,
      collaboratorInput,
      collaborators,
      aiDisclosureChoice,
      aiDisclosureDetails,
      fileName,
      publishFeeBreakdown,
    });
  }, [
    wallet,
    step,
    title,
    abstract,
    field,
    keywordInput,
    keywords,
    collaboratorInput,
    collaborators,
    aiDisclosureChoice,
    aiDisclosureDetails,
    fileName,
    publishFeeBreakdown,
  ]);

  if (isLoading) {
    return <TabState type="loading" title="Loading upload form" description="Preparing submission workspace." />;
  }

  if (error) {
    return <TabState type="error" title="Could not load upload form" description={error} />;
  }

  const canAddKeyword = useMemo(
    () => keywordInput.trim().length > 0 && keywords.length < 6,
    [keywordInput, keywords.length]
  );
  const canAddCollaborator = useMemo(
    () => collaboratorInput.trim().length > 0 && collaborators.length < 8,
    [collaboratorInput, collaborators.length]
  );
  const hasValidAiDisclosure =
    aiDisclosureChoice === "no" || (aiDisclosureChoice === "yes" && aiDisclosureDetails.trim().length > 0);
  const canContinueDetails = title.trim() && abstract.trim() && field && hasValidAiDisclosure;
  const canContinueUpload = Boolean(fileName);

  const addKeyword = () => {
    const value = toTitleCase(keywordInput.trim());
    const keywordError = getContentValidationError(value, "Keyword");
    if (keywordError) {
      setValidationError(keywordError);
      return;
    }
    const exists = keywords.some((k) => k.toLowerCase() === value.toLowerCase());
    if (!value || exists || keywords.length >= 6) return;
    setKeywords((prev) => [...prev, value]);
    setKeywordInput("");
    setValidationError("");
  };

  const removeKeyword = (value) => {
    setKeywords((prev) => prev.filter((k) => k !== value));
  };

  const addCollaborator = () => {
    const value = normalizeCollaboratorName(collaboratorInput.trim());
    const collaboratorError = getContentValidationError(value, "Collaborator name");
    if (collaboratorError) {
      setValidationError(collaboratorError);
      return;
    }
    const exists = collaborators.some((name) => name.toLowerCase() === value.toLowerCase());
    if (!value || exists || collaborators.length >= 8) return;
    setCollaborators((prev) => [...prev, value]);
    setCollaboratorInput("");
    setValidationError("");
  };

  const removeCollaborator = (value) => {
    setCollaborators((prev) => prev.filter((name) => name !== value));
  };

  const onFileSelected = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setSelectedFile(file);
    saveUploadFileDraft(wallet, file);
  };

  const resetFlow = () => {
    clearUploadDraft(wallet);
    setStep(1);
    setTitle("");
    setAbstract("");
    setField("");
    setKeywordInput("");
    setKeywords([]);
    setCollaboratorInput("");
    setCollaborators([]);
    setAiDisclosureChoice("");
    setAiDisclosureDetails("");
    setFileName("");
    setSelectedFile(null);
    clearUploadFileDraft(wallet);
    setValidationError("");
    setPublishFeeBreakdown(null);
  };

  const handleContinueDetails = () => {
    const normalizedTitle = toTitleCase(title.trim());
    const normalizedField = toTitleCase(field.trim());
    const normalizedKeywords = keywords.map((k) => toTitleCase(k.trim())).filter(Boolean);
    const normalizedCollaborators = collaborators
      .map((name) => normalizeCollaboratorName(name))
      .filter(Boolean);
    if (aiDisclosureChoice !== "yes" && aiDisclosureChoice !== "no") {
      setValidationError("Please disclose whether AI-generated text was used.");
      return;
    }
    if (aiDisclosureChoice === "yes" && !aiDisclosureDetails.trim()) {
      setValidationError("Please describe AI-generated text usage.");
      return;
    }
    const detailsText = `${normalizedTitle} ${abstract} ${normalizedKeywords.join(" ")} ${normalizedCollaborators.join(" ")}`;
    const detailsError = getContentValidationError(detailsText, "Paper details");
    if (detailsError) {
      setValidationError(detailsError);
      return;
    }
    setTitle(normalizedTitle);
    setField(normalizedField);
    setKeywords(normalizedKeywords);
    setCollaborators(normalizedCollaborators);
    setValidationError("");
    setStep(2);
  };

  const handleSubmitPaper = async () => {
    const derivedPaperId = buildSubmissionPaperId({
      wallet,
      title,
      fileName,
      reviewDeadline,
    });

    if (!selectedFile) {
      setValidationError(
        "Please reselect the PDF before submitting. Browser security does not restore file bytes automatically after the file input unmounts."
      );
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitStage("Refreshing wallet balance");
      const liveWalletBalance = await refreshWalletBalanceFromChain();
      setTokenomicsState((prev) => ({ ...prev, walletBalance: liveWalletBalance }));
      if (Number(liveWalletBalance || 0) < Number(effectiveSubmissionFee || 0)) {
        throw new Error(
          `This submission requires ${formatTokenAmount(effectiveSubmissionFee)} DST, but the connected wallet only has ${formatTokenAmount(liveWalletBalance)} DST. Please top up more DST before submitting.`
        );
      }

      setSubmitStage("Creating submission artifacts");
      const artifactResult = await createSubmissionArtifacts({
        paperId: derivedPaperId,
        authorWallet: wallet,
        title: toTitleCase(title),
        category: field,
        abstract,
        file: selectedFile,
        reviewDeadline,
        keywords,
        collaborators,
        aiGeneratedDisclosure: {
          used: aiDisclosureChoice === "yes",
          details: aiDisclosureDetails.trim(),
        },
      });
      setSubmitStage("Step 1/3: Approve DST if MetaMask asks");
      setSubmitStage("Step 2/3: Reserving the submission fee on-chain");
      const paymentResult = await reserveSubmissionFeeOnChain(derivedPaperId, effectiveSubmissionFee);
      setSubmitStage("Step 3/3: Writing the paper submission on-chain");
      const submissionResult = await submitPaperOnChain({
        paperId: derivedPaperId,
        title: toTitleCase(title),
        category: field,
        abstractCid: artifactResult.abstractCid || "",
        submissionMetadataCid: artifactResult.submissionMetadataCid || "",
      });
      const nextWalletBalance = await refreshWalletBalanceFromChain();
      const feeBreakdown = buildFeeBreakdown(effectiveSubmissionFee);
      setTokenomicsState((prev) => ({ ...prev, walletBalance: nextWalletBalance }));
      setPublishFeeBreakdown(feeBreakdown);
      appendAuditEvent(wallet, {
        eventType: "publish",
        status: "payment_confirmed",
        stage: "submission",
        title: toTitleCase(title || "Untitled"),
        feeDst: roundTo2(effectiveSubmissionFee),
        txHash: paymentResult.txHash,
        paperId: derivedPaperId,
      });
      appendAuditEvent(wallet, {
        eventType: "paper_submitted",
        status: "chain_confirmed",
        title: toTitleCase(title || "Untitled"),
        txHash: submissionResult.txHash,
        paperId: derivedPaperId,
      });
      saveSubmissionMetadata({
        authorWallet: wallet,
        paperId: derivedPaperId,
        title: toTitleCase(title),
        collaborators,
        abstract,
        researchField: field,
        keywords,
        fileName,
        reviewDeadline,
        abstractCid: artifactResult.abstractCid || "",
        submissionMetadataCid: artifactResult.submissionMetadataCid || "",
        manuscriptCid: artifactResult.manuscriptCid || "",
        artifactVisibility: artifactResult.visibility || "private",
        artifactPinStatus: artifactResult.pinStatus || "temporary",
        aiGeneratedDisclosure: {
          used: aiDisclosureChoice === "yes",
          details: aiDisclosureDetails.trim(),
        },
      });
      upsertCanonicalReviewSession(
        buildInitialReviewSession({
          paperId: derivedPaperId,
          title: toTitleCase(title),
          field,
          deadline: reviewDeadline,
          authorWallet: wallet,
          baseReward: perReviewerReward,
        })
      );
      appendAuditEvent(wallet, {
        eventType: "paper_submitted",
        status: "success",
        title: toTitleCase(title || "Untitled"),
        reviewDeadline,
        feeDst: roundTo2(feeBreakdown.totalFee),
        paperId: derivedPaperId,
      });
      appendAuditEvent(wallet, {
        eventType: "reward_reserved",
        status: "success",
        title: toTitleCase(title || "Untitled"),
        reservedRewardPoolDst: roundTo2(feeBreakdown.reviewerPoolContribution),
        feeVaultDst: roundTo2(feeBreakdown.gasContribution),
        paperId: derivedPaperId,
      });
      appendAuditEvent(wallet, {
        eventType: "publish",
        status: "success",
        stage: "submission",
        title: toTitleCase(title || "Untitled"),
        feeDst: roundTo2(feeBreakdown.totalFee),
        reviewerPoolDst: roundTo2(feeBreakdown.reviewerPoolContribution),
        gasTreasuryDst: roundTo2(feeBreakdown.gasContribution),
        paperId: derivedPaperId,
      });
      setValidationError("");
      clearUploadFileDraft(wallet);
      showToast(`Paper "${toTitleCase(title || "Untitled")}" submission fee paid on-chain.`);
      setStep(4);
    } catch (error) {
      setValidationError(
        getSubmissionErrorMessage(error, {
          requiredDst: effectiveSubmissionFee,
          walletBalance: tokenomicsState.walletBalance,
        })
      );
      appendAuditEvent(wallet, {
        eventType: "publish",
        status: "failed_payment",
        stage: "submission",
        title: toTitleCase(title || "Untitled"),
        feeDst: roundTo2(effectiveSubmissionFee),
        paperId: derivedPaperId,
      });
    } finally {
      setIsSubmitting(false);
      setSubmitStage("");
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4">
        <TabHeader title="Upload Paper" subtitle="Submit your paper details and file for reviewer assignment" />
        <div className="mt-3 inline-flex rounded-xl bg-[#ececf1] px-4 py-2 text-sm text-[#111322]">
          Wallet balance: <span className="ml-1 font-semibold">{formatTokenAmount(tokenomicsState.walletBalance)} DST</span>
        </div>
      </div>
      <StepIndicator currentStep={step} />

      <div className="rounded-2xl border border-[#d8dbe6] bg-[#f8f8fb] p-6">
        {step === 1 && (
          <>
            <h3 className="text-3xl font-semibold text-[#111322]">Paper Details</h3>

            <div className="mt-6 space-y-5">
              <div>
                <label className="mb-2 block text-base font-semibold text-[#111322]">Title</label>
                <input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setValidationError("");
                  }}
                  placeholder="Enter paper title"
                  className="w-full rounded-xl border border-[#d7d9e3] bg-white px-4 py-3 text-base outline-none focus:ring-2 focus:ring-[#6828ce]/20"
                />
              </div>

              <div>
                <label className="mb-2 block text-base font-semibold text-[#111322]">Abstract</label>
                <textarea
                  value={abstract}
                  onChange={(e) => {
                    setAbstract(e.target.value);
                    setValidationError("");
                  }}
                  rows={5}
                  placeholder="Write a brief abstract..."
                  className="w-full rounded-xl border border-[#d7d9e3] bg-white px-4 py-3 text-base outline-none focus:ring-2 focus:ring-[#6828ce]/20"
                />
              </div>

              <div>
                <label className="mb-2 block text-base font-semibold text-[#111322]">Research Field</label>
                <div className="relative">
                  <select
                    value={field}
                    onChange={(e) => {
                      setField(e.target.value);
                      setValidationError("");
                    }}
                    className="w-full appearance-none rounded-xl border border-[#d7d9e3] bg-white px-4 py-3 text-base outline-none focus:ring-2 focus:ring-[#6828ce]/20"
                  >
                    <option value="" disabled>
                      Select field
                    </option>
                    {researchFields.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#707690]" />
                </div>
              </div>

              <div>
                <label className="mb-2 block text-base font-semibold text-[#111322]">Keywords</label>
                <div className="flex gap-3">
                  <input
                    value={keywordInput}
                    onChange={(e) => {
                      setKeywordInput(e.target.value);
                      setValidationError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addKeyword();
                      }
                    }}
                    placeholder="Add keyword"
                    className="flex-1 rounded-xl border border-[#d7d9e3] bg-white px-4 py-3 text-base outline-none focus:ring-2 focus:ring-[#6828ce]/20"
                  />
                  <button
                    type="button"
                    disabled={!canAddKeyword}
                    onClick={addKeyword}
                    className="rounded-xl bg-[#ececf1] px-5 text-base font-semibold text-[#111322] disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                <p className="mt-2 text-xs text-[#7a8096]">
                  Up to 6 keywords.
                </p>

                {keywords.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {keywords.map((keyword) => (
                      <span
                        key={keyword}
                        className="inline-flex items-center gap-2 rounded-full bg-[#ececf1] px-3 py-1 text-sm text-[#1f2437]"
                      >
                        {keyword}
                        <button
                          type="button"
                          onClick={() => removeKeyword(keyword)}
                          aria-label={`Remove ${keyword}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div>
                <label className="mb-2 block text-base font-semibold text-[#111322]">
                  Collaborators (Optional)
                </label>
                <div className="flex gap-3">
                  <input
                    value={collaboratorInput}
                    onChange={(e) => {
                      setCollaboratorInput(e.target.value);
                      setValidationError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addCollaborator();
                      }
                    }}
                    placeholder="Add collaborator name"
                    className="flex-1 rounded-xl border border-[#d7d9e3] bg-white px-4 py-3 text-base outline-none focus:ring-2 focus:ring-[#6828ce]/20"
                  />
                  <button
                    type="button"
                    disabled={!canAddCollaborator}
                    onClick={addCollaborator}
                    className="rounded-xl bg-[#ececf1] px-5 text-base font-semibold text-[#111322] disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
                <p className="mt-2 text-xs text-[#7a8096]">
                  Up to 8 collaborators. Names are revealed only after official publication.
                </p>

                {collaborators.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {collaborators.map((name) => (
                      <span
                        key={name}
                        className="inline-flex items-center gap-2 rounded-full bg-[#ececf1] px-3 py-1 text-sm text-[#1f2437]"
                      >
                        {name}
                        <button
                          type="button"
                          onClick={() => removeCollaborator(name)}
                          aria-label={`Remove ${name}`}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>

              <div>
                <label className="mb-2 block text-base font-semibold text-[#111322]">
                  Review Timeline
                </label>
                <div className="rounded-xl border border-[#d7d9e3] bg-white px-4 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm text-[#5f657d]">Complexity assessment</div>
                      <div className="text-base font-semibold text-[#111322]">
                        {reviewPlan.complexityLabel}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-[#5f657d]">Suggested review deadline</div>
                      <div className="text-base font-semibold text-[#111322]">
                        {formatDisplayDate(reviewDeadline)}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 text-sm text-[#5f657d] sm:grid-cols-3">
                    <div className="rounded-lg bg-[#fafafe] px-3 py-2">
                      Reviewer matching buffer:{" "}
                      <span className="font-semibold text-[#111322]">{reviewPlan.reviewerBufferDays} days</span>
                    </div>
                    <div className="rounded-lg bg-[#fafafe] px-3 py-2">
                      Review window:{" "}
                      <span className="font-semibold text-[#111322]">{REVIEW_WINDOW_DAYS} days</span>
                    </div>
                    <div className="rounded-lg bg-[#fafafe] px-3 py-2">
                      Total schedule:{" "}
                      <span className="font-semibold text-[#111322]">{reviewPlan.totalTimelineDays} days</span>
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-xs text-[#7a8096]">
                  The deadline is set automatically from paper complexity, adds a 7-10 day buffer to secure 3 reviewers, then applies a recommended 3-week review period.
                </p>
              </div>

              <div>
                <label className="mb-2 block text-base font-semibold text-[#111322]">
                  AI-Generated Text Disclosure
                </label>
                <div className="space-y-2 text-sm text-[#111322]">
                  <label className="flex items-center gap-3">
                    <input
                      className="h-4 w-4 shrink-0"
                      type="radio"
                      name="ai-disclosure"
                      checked={aiDisclosureChoice === "no"}
                      onChange={() => {
                        setAiDisclosureChoice("no");
                        setValidationError("");
                      }}
                    />
                    No AI-generated text used
                  </label>
                  <label className="flex items-center gap-3">
                    <input
                      className="h-4 w-4 shrink-0"
                      type="radio"
                      name="ai-disclosure"
                      checked={aiDisclosureChoice === "yes"}
                      onChange={() => {
                        setAiDisclosureChoice("yes");
                        setValidationError("");
                      }}
                    />
                    AI-generated text used (disclose details)
                  </label>
                </div>
                {aiDisclosureChoice === "yes" ? (
                  <textarea
                    value={aiDisclosureDetails}
                    onChange={(e) => {
                      setAiDisclosureDetails(e.target.value);
                      setValidationError("");
                    }}
                    rows={3}
                    placeholder="Describe where and how AI-generated text was used..."
                    className="mt-3 w-full rounded-xl border border-[#d7d9e3] bg-white px-4 py-3 text-base outline-none focus:ring-2 focus:ring-[#6828ce]/20"
                  />
                ) : null}
              </div>

              <button
                type="button"
                disabled={!canContinueDetails}
                onClick={handleContinueDetails}
                className={[
                  "w-full rounded-xl py-3 text-base font-semibold text-white",
                  canContinueDetails
                    ? "bg-[#6828ce] hover:bg-[#5a24b4]"
                    : "bg-[#a487df] cursor-not-allowed",
                ].join(" ")}
              >
                Continue
              </button>
              {validationError ? (
                <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
                  {validationError}
                </div>
              ) : null}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <h3 className="text-3xl font-semibold text-[#111322]">Upload File</h3>

            <div className="mt-6">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full rounded-2xl border-2 border-dashed border-[#d5d8e2] bg-white p-12 text-center transition-colors hover:border-[#b8bcd0]"
              >
                {fileName ? (
                  <>
                    <FileText className="mx-auto mb-2 h-10 w-10 text-[#6828ce]" />
                    <p className="text-sm font-medium text-[#111322]">{fileName}</p>
                    <p className="text-xs text-[#7a8096]">Click to change file</p>
                  </>
                ) : (
                  <>
                    <Upload className="mx-auto mb-2 h-10 w-10 text-[#6d7183]" />
                    <p className="text-sm text-[#5f657d]">Click to upload or drag and drop</p>
                    <p className="text-xs text-[#7a8096]">PDF up to 50MB</p>
                  </>
                )}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={onFileSelected}
              />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="rounded-xl border border-[#d7d9e3] bg-white py-3 text-base font-semibold text-[#111322]"
              >
                Back
              </button>
              <button
                type="button"
                disabled={!canContinueUpload}
                onClick={() => setStep(3)}
                className={[
                  "rounded-xl py-3 text-base font-semibold text-white",
                  canContinueUpload
                    ? "bg-[#6828ce] hover:bg-[#5a24b4]"
                    : "bg-[#a487df] cursor-not-allowed",
                ].join(" ")}
              >
                Continue
              </button>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <h3 className="text-3xl font-semibold text-[#111322]">Preview & Submit</h3>

            <div className="mt-6 rounded-2xl bg-[#ececf1] p-5">
              <div className="mb-3 text-base">
                <span className="text-[#666c84]">Title:</span>{" "}
                <span className="font-semibold text-[#111322]">{title || "None"}</span>
              </div>
              <div className="mb-3 text-base">
                <span className="text-[#666c84]">Field:</span>{" "}
                <span className="font-semibold text-[#111322]">{field}</span>
              </div>
              <div className="mb-3 text-base">
                <span className="text-[#666c84]">File:</span>{" "}
                <span className="font-semibold text-[#111322]">{fileName || "No file selected"}</span>
              </div>
              <div className="mb-3 text-base">
                <span className="text-[#666c84]">Keywords:</span>{" "}
                <span className="font-semibold text-[#111322]">
                  {keywords.length ? keywords.join(", ") : "None"}
                </span>
              </div>
              <div className="mb-3 text-base">
                <span className="text-[#666c84]">Collaborators:</span>{" "}
                <span className="font-semibold text-[#111322]">
                  {collaborators.length ? collaborators.join(", ") : "None"}
                </span>
              </div>
              <div className="mb-3 text-base">
                <span className="text-[#666c84]">AI disclosure:</span>{" "}
                <span className="font-semibold text-[#111322]">
                  {aiDisclosureChoice === "yes" ? "Yes" : "No"}
                </span>
                {aiDisclosureChoice === "yes" && aiDisclosureDetails.trim() ? (
                  <p className="mt-1 whitespace-pre-wrap text-[#111322]">{aiDisclosureDetails.trim()}</p>
                ) : null}
              </div>
              <div className="text-base">
                <span className="text-[#666c84]">Abstract:</span>
                <p className="mt-1 whitespace-pre-wrap text-[#111322]">{abstract || "None"}</p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-[#d7d9e3] bg-white p-5">
              <div className="text-base font-semibold text-[#111322]">Publishing Fee Breakdown</div>
              <div className="mt-3 space-y-2 text-sm text-[#5f657d]">
                <div className="flex items-center justify-between">
                  <span>Total submission fee</span>
                  <span className="font-semibold text-[#111322]">{formatTokenAmount(effectiveSubmissionFee)} DST</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Reviewer reward pool (for 3 on-time reviewers)</span>
                  <span className="font-semibold text-[#111322]">
                    {formatTokenAmount(reviewerPoolFeeShare)} DST
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Per on-time reviewer reward</span>
                  <span className="font-semibold text-[#111322]">{formatTokenAmount(perReviewerReward)} DST</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>FeeVault (storage + protocol operations)</span>
                  <span className="font-semibold text-[#111322]">
                    {formatTokenAmount(gasFeeShare)} DST
                  </span>
                </div>
              </div>
              <div className="mt-4 rounded-xl bg-[#fafafe] px-4 py-3 text-xs text-[#5f657d]">
                <div className="font-semibold text-[#111322]">Fee disclosure</div>
                <div className="mt-1">
                  Submitting now transfers the displayed DST submission fee into the on-chain protocol vault.
                </div>
                <div className="mt-1">
                  MetaMask may ask for up to three confirmations: DST approval, submission fee reservation, and final on-chain paper submission.
                </div>
              </div>
            </div>

            {isSubmitting && submitStage ? (
              <div className="mt-4 rounded-xl bg-[#f3edff] px-4 py-3 text-sm text-[#4f2aa8]">
                {submitStage}
              </div>
            ) : null}

            <div className="mt-5 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={isSubmitting}
                className="rounded-xl border border-[#d7d9e3] bg-white py-3 text-base font-semibold text-[#111322]"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleSubmitPaper}
                disabled={isSubmitting}
                className="rounded-xl bg-[#6828ce] py-3 text-base font-semibold text-white hover:bg-[#5a24b4] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? "Waiting For MetaMask..." : "Submit Paper"}
              </button>
            </div>
            {validationError ? (
              <div className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
                {validationError}
              </div>
            ) : null}
          </>
        )}

        {step === 4 && (
          <div className="py-8 text-center">
            <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-[#ece7f8]">
              <Check className="h-10 w-10 text-[#6828ce]" />
            </div>
            <h3 className="text-3xl font-semibold text-[#111322]">Paper Submitted!</h3>
            <p className="mx-auto mt-3 max-w-lg text-lg text-[#5f657d]">
              Your paper "{title || "Untitled"}" has been submitted successfully and entered the review workflow.
            </p>
            {publishFeeBreakdown ? (
              <div className="mx-auto mt-5 max-w-lg rounded-2xl bg-[#ececf1] p-4 text-left text-sm text-[#111322]">
                <div className="font-semibold">Fee charged: {formatTokenAmount(publishFeeBreakdown.totalFee)} DST</div>
                <div className="mt-1">Reviewer reward pool credited: {formatTokenAmount(publishFeeBreakdown.reviewerPoolContribution)} DST</div>
                <div>FeeVault credited for storage + protocol operations: {formatTokenAmount(publishFeeBreakdown.gasContribution)} DST</div>
                <div className="mt-1">Wallet balance now: {formatTokenAmount(tokenomicsState.walletBalance)} DST</div>
              </div>
            ) : null}
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => navigate("/dashboard")}
                className="rounded-xl border border-[#d7d9e3] bg-white px-6 py-3 text-base font-semibold text-[#111322]"
              >
                Browse Papers
              </button>
              <button
                type="button"
                onClick={resetFlow}
                className="rounded-xl bg-[#6828ce] px-6 py-3 text-base font-semibold text-white hover:bg-[#5a24b4]"
              >
                Upload Another
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTokenAmount(value) {
  return Number(value || 0).toFixed(2);
}

function roundTo2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function computeReviewPlan({
  title,
  abstract,
  field,
  keywords,
  collaborators,
  aiDisclosureChoice,
  aiDisclosureDetails,
}) {
  const complexityScore =
    getAbstractComplexityScore(abstract) +
    getFieldComplexityScore(field) +
    Math.min(2, Math.floor((Array.isArray(keywords) ? keywords.length : 0) / 2)) +
    (Array.isArray(collaborators) && collaborators.length >= 3 ? 1 : 0) +
    (String(aiDisclosureChoice || "").trim().toLowerCase() === "yes" ? 1 : 0) +
    (String(aiDisclosureDetails || "").trim().length > 180 ? 1 : 0) +
    (String(title || "").trim().length > 90 ? 1 : 0);

  let complexityTier = "low";
  if (complexityScore >= 7) {
    complexityTier = "high";
  } else if (complexityScore >= 4) {
    complexityTier = "medium";
  }

  const reviewerBufferDays = REVIEWER_MATCH_BUFFER_DAYS[complexityTier];
  const totalTimelineDays = reviewerBufferDays + REVIEW_WINDOW_DAYS;

  return {
    complexityTier,
    complexityLabel: complexityTier.charAt(0).toUpperCase() + complexityTier.slice(1),
    reviewerBufferDays,
    totalTimelineDays,
    reviewDeadline: offsetDate(totalTimelineDays),
  };
}

function getAbstractComplexityScore(value) {
  const wordCount = String(value || "").trim().split(/\s+/).filter(Boolean).length;
  if (wordCount >= 260) return 3;
  if (wordCount >= 160) return 2;
  if (wordCount >= 80) return 1;
  return 0;
}

function getFieldComplexityScore(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["cryptography", "security", "formal methods", "distributed systems"].includes(normalized)) {
    return 2;
  }
  if (["computer science", "data science", "networking"].includes(normalized)) {
    return 1;
  }
  return 0;
}

function formatDisplayDate(value) {
  const ts = new Date(`${String(value || "").trim()}T00:00:00Z`);
  if (!Number.isFinite(ts.getTime())) return "-";
  return ts.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function buildFeeBreakdown(totalFee) {
  const safeTotal = roundTo2(Number(totalFee || 0));
  const reviewerPoolContribution = roundTo2(safeTotal * 0.75);
  return {
    totalFee: safeTotal,
    reviewerPoolContribution,
    gasContribution: roundTo2(safeTotal - reviewerPoolContribution),
  };
}

function buildSubmissionPaperId({ wallet, title, fileName, reviewDeadline }) {
  return [
    String(wallet || "unknown").toLowerCase(),
    toTitleCase(title || "untitled"),
    String(fileName || "draft.pdf").trim(),
    String(reviewDeadline || "").trim(),
  ].join("|");
}

const BANNED_WORDS = [
  "fuck",
  "fucking",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "dick",
  "pussy",
  "cunt",
  "motherfucker",
];

function getContentValidationError(text, label) {
  if (!text) return "";

  if (containsBannedWord(text)) {
    return `${label} contains inappropriate language. Please remove it.`;
  }

  if (containsGibberishWord(text)) {
    return `${label} contains a suspicious long gibberish word. Please use meaningful words.`;
  }

  return "";
}

function containsBannedWord(text) {
  const normalized = String(text).toLowerCase();
  return BANNED_WORDS.some((word) => {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`\\b${escaped}\\b`, "i");
    return pattern.test(normalized);
  });
}

function containsGibberishWord(text) {
  const words = String(text).toLowerCase().match(/[a-z]{8,}/g) || [];
  return words.some((word) => isSuspiciousLongWord(word));
}

function isSuspiciousLongWord(word) {
  if (word.length < 12) return false;

  const vowels = (word.match(/[aeiou]/g) || []).length;
  const vowelRatio = vowels / word.length;
  const uniqueRatio = new Set(word).size / word.length;
  const maxConsonantRun = getMaxConsonantRun(word);

  return maxConsonantRun >= 4 || uniqueRatio < 0.34 || (vowelRatio < 0.30 && uniqueRatio < 0.50);
}

function getMaxConsonantRun(word) {
  let best = 0;
  let run = 0;
  for (const ch of word) {
    if (/[aeiou]/.test(ch)) {
      run = 0;
    } else {
      run += 1;
      if (run > best) best = run;
    }
  }
  return best;
}

function toTitleCase(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((word) =>
      word
        .split("-")
        .map((part) =>
          part ? `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}` : part
        )
        .join("-")
    )
    .join(" ");
}

function normalizeCollaboratorName(value) {
  return toTitleCase(String(value || "").replace(/\s+/g, " ").trim());
}

function offsetDate(daysFromToday) {
  const now = new Date();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  target.setUTCDate(target.getUTCDate() + Number(daysFromToday || 0));
  return target.toISOString().slice(0, 10);
}

function getUploadDraftStorageKey(wallet) {
  const normalizedWallet = String(wallet || "").trim().toLowerCase();
  return normalizedWallet ? `${UPLOAD_DRAFT_KEY}:${normalizedWallet}` : UPLOAD_DRAFT_KEY;
}

function getUploadFileDraftKey(wallet) {
  const normalizedWallet = String(wallet || "").trim().toLowerCase();
  return normalizedWallet ? `uploadPaperFile:${normalizedWallet}` : "uploadPaperFile";
}

function loadUploadFileDraft(wallet) {
  return uploadFileDrafts.get(getUploadFileDraftKey(wallet)) || null;
}

function saveUploadFileDraft(wallet, file) {
  const key = getUploadFileDraftKey(wallet);
  if (!file) {
    uploadFileDrafts.delete(key);
    return;
  }
  uploadFileDrafts.set(key, file);
}

function clearUploadFileDraft(wallet) {
  uploadFileDrafts.delete(getUploadFileDraftKey(wallet));
}

function createEmptyUploadDraft() {
  return {
    step: 1,
    title: "",
    abstract: "",
    field: "",
    keywordInput: "",
    keywords: [],
    collaboratorInput: "",
    collaborators: [],
    aiDisclosureChoice: "",
    aiDisclosureDetails: "",
    fileName: "",
    publishFeeBreakdown: null,
  };
}

function loadUploadDraft(wallet) {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(getUploadDraftStorageKey(wallet)) || "null"
    );
    if (!parsed || typeof parsed !== "object") {
      return createEmptyUploadDraft();
    }
    return {
      step: normalizeDraftStep(parsed.step),
      title: String(parsed.title || ""),
      abstract: String(parsed.abstract || ""),
      field: String(parsed.field || ""),
      keywordInput: String(parsed.keywordInput || ""),
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords.map((value) => String(value || "")).filter(Boolean) : [],
      collaboratorInput: String(parsed.collaboratorInput || ""),
      collaborators: Array.isArray(parsed.collaborators)
        ? parsed.collaborators.map((value) => String(value || "")).filter(Boolean)
        : [],
      aiDisclosureChoice: String(parsed.aiDisclosureChoice || ""),
      aiDisclosureDetails: String(parsed.aiDisclosureDetails || ""),
      fileName: String(parsed.fileName || ""),
      publishFeeBreakdown:
        parsed.publishFeeBreakdown && typeof parsed.publishFeeBreakdown === "object"
          ? {
              totalFee: roundTo2(parsed.publishFeeBreakdown.totalFee),
              reviewerPoolContribution: roundTo2(parsed.publishFeeBreakdown.reviewerPoolContribution),
              gasContribution: roundTo2(parsed.publishFeeBreakdown.gasContribution),
            }
          : null,
    };
  } catch {
    return createEmptyUploadDraft();
  }
}

function persistUploadDraft(wallet, draft) {
  try {
    localStorage.setItem(
      getUploadDraftStorageKey(wallet),
      JSON.stringify({
        step: normalizeDraftStep(draft?.step),
        title: String(draft?.title || ""),
        abstract: String(draft?.abstract || ""),
        field: String(draft?.field || ""),
        keywordInput: String(draft?.keywordInput || ""),
        keywords: Array.isArray(draft?.keywords) ? draft.keywords : [],
        collaboratorInput: String(draft?.collaboratorInput || ""),
        collaborators: Array.isArray(draft?.collaborators) ? draft.collaborators : [],
        aiDisclosureChoice: String(draft?.aiDisclosureChoice || ""),
        aiDisclosureDetails: String(draft?.aiDisclosureDetails || ""),
        fileName: String(draft?.fileName || ""),
        publishFeeBreakdown: draft?.publishFeeBreakdown || null,
      })
    );
  } catch {
    // ignore storage failures in restricted environments
  }
}

function clearUploadDraft(wallet) {
  try {
    localStorage.removeItem(getUploadDraftStorageKey(wallet));
  } catch {
    // ignore storage failures in restricted environments
  }
}

function normalizeDraftStep(value) {
  const numeric = Number(value || 1);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(4, Math.trunc(numeric)));
}

function getSubmissionErrorMessage(error, { requiredDst = 0, walletBalance = 0 } = {}) {
  const message = String(error?.message || "").trim();
  if (!message) {
    return "Paper submission failed. Please try again.";
  }
  if (message.includes("User denied transaction signature")) {
    return "Paper submission was cancelled in MetaMask.";
  }
  if (message.includes("requires") && message.includes("DST")) {
    return message;
  }
  if (
    message.includes("missing revert data") ||
    message.includes("CALL_EXCEPTION") ||
    message.includes("estimateGas")
  ) {
    return `Paper submission could not reserve the ${formatTokenAmount(requiredDst)} DST fee. The connected wallet currently has ${formatTokenAmount(walletBalance)} DST. Refresh the balance or top up more DST before submitting.`;
  }
  return formatWalletActionError(error, message || "Paper submission failed. Please try again.");
}

function buildInitialReviewSession({
  paperId,
  title,
  field,
  deadline,
  authorWallet,
  baseReward,
}) {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: `session-${String(paperId || "").trim().toLowerCase()}`,
    paperId: String(paperId || "").trim(),
    title: String(title || "").trim(),
    field: String(field || "").trim(),
    deadline: String(deadline || "").trim(),
    authorWallet: String(authorWallet || "").trim().toLowerCase(),
    phase: "blind_review",
    decision: "",
    officiallyPublished: false,
    revisionCycle: 0,
    reviewRoundStatus: "active",
    highPriority: false,
    finalized: false,
    tokenReward: roundTo2(Number(baseReward || 0)),
    reservedRewardPoolDst: roundTo2(Number(baseReward || 0) * 3),
    rewardPoolRemainingDst: roundTo2(Number(baseReward || 0) * 3),
    rewardPaidDst: 0,
    slashedStakeTreasuryDst: 0,
    resolutionReason: "",
    authorActionRequired: false,
    authorActionOptions: [],
    reviewers: Array.from({ length: 3 }, (_, index) => ({
      id: `${String(paperId || "").trim().toLowerCase()}-slot-${index + 1}`,
      reviewerWallet: null,
      requestStatus: "requested",
      requestOpenedOn: today,
      requestExpiresOn: today,
      requestRound: 1,
      revealIdentityAfterPublish: false,
      reviewerPublicName: "",
      stakedTokens: 0,
      stakeStatus: "none",
      stakeJoinedAt: null,
      rewardEarned: 0,
      vote: null,
      summary: "",
      strengths: "",
      weaknesses: "",
      requiredChanges: "",
      submittedDate: null,
      rebuttalComment: "",
      rebuttalVote: null,
    })),
  };
}

