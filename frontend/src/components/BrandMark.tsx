import { Landmark } from "lucide-react";

export function BrandMark({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className={`lh-brand ${inverse ? "lh-brand--inverse" : ""}`}>
      <span className="lh-brand__mark" aria-hidden="true"><Landmark size={19} strokeWidth={1.8} /></span>
      <span>LendersHub</span>
    </span>
  );
}
