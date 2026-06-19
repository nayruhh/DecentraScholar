import { useState } from "react";
import { X } from "lucide-react";
import { loadProfileDisplayName } from "../../../services/browserSession";

function normalizeFirstLastName(rawName) {
  const parts = (rawName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

export default function PublishConfirmModal({ paper, onConfirm, onCancel }) {
  const [authorName, setAuthorName] = useState(
    () => normalizeFirstLastName(loadProfileDisplayName()) || ""
  );
  const [publishCollaboratorNames, setPublishCollaboratorNames] = useState(true);

  const collaborators = Array.isArray(paper?.collaborators) ? paper.collaborators : [];
  const aiDisclosure = paper?.aiGeneratedDisclosure || { used: false, details: "" };

  const handleConfirm = () => {
    onConfirm({
      publishedAuthorName: normalizeFirstLastName(authorName),
      publishCollaboratorNames,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#111322]">Confirm Official Publication</h2>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1 text-[#6b7189] hover:bg-[#f2f3f8]"
            aria-label="Cancel"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mb-4 rounded-lg bg-[#f3f4f9] px-4 py-3 text-sm font-medium text-[#111322]">
          {paper?.title || "Untitled Paper"}
        </div>

        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[#111322]">
              Your public author name
            </label>
            <input
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="Leave blank to show wallet address"
              className="w-full rounded-lg border border-[#d7d9e3] bg-white px-4 py-3 text-sm outline-none"
            />
            <p className="mt-1 text-xs text-[#6b7189]">
              If left blank, your wallet address will be shown publicly.
            </p>
          </div>

          {collaborators.length > 0 ? (
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={publishCollaboratorNames}
                onChange={(e) => setPublishCollaboratorNames(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#6828ce]"
              />
              <span className="text-sm text-[#111322]">
                Show collaborator names publicly:{" "}
                <span className="text-[#6b7189]">{collaborators.join(", ")}</span>
              </span>
            </label>
          ) : null}

          <div className="rounded-lg border border-[#e7e8ef] bg-[#fafafe] px-4 py-3 text-xs text-[#5f657d]">
            <div className="font-semibold text-[#111322]">AI-Generated Content Disclosure</div>
            <div className="mt-1">
              {aiDisclosure.used
                ? `AI assistance used: ${aiDisclosure.details || "Not specified."}`
                : "No AI-generated content declared for this submission."}
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 rounded-lg bg-[#6828ce] px-5 py-3 text-sm font-semibold text-white hover:bg-[#5a24b4]"
          >
            Confirm &amp; Publish
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-[#d7d9e3] bg-white px-5 py-3 text-sm font-semibold text-[#111322] hover:bg-[#f4f4f8]"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
