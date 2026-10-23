export const STAGES = ["trigger", "investigate", "reproduce", "fix", "verify", "report"];
export const TIERS = ["nano", "super", "ultra"];

export const TIER_LABEL = { nano: "Nano", super: "Super", ultra: "Ultra" };
export const TIER_BG = { nano: "bg-nano", super: "bg-super", ultra: "bg-ultra" };

export const STAGE_LABEL = {
  trigger: "Trigger", investigate: "Investigate", reproduce: "Reproduce", fix: "Fix", verify: "Verify", report: "Report",
};

export function fmtTokens(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}
