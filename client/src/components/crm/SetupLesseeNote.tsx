import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";

export default function SetupLesseeNote({ accountId, accountName }: { accountId: number; accountName: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm space-y-2">
      <p>
        Next: set up the lessee in Lease Management. Use the exact name {accountName} so it links automatically.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void navigator.clipboard.writeText(accountName).then(() => setCopied(true));
          }}
        >
          {copied ? "Copied" : "Copy name"}
        </Button>
        <Button type="button" size="sm" asChild>
          <Link href={`/lease-wizard?account_id=${accountId}`}>Open lease wizard</Link>
        </Button>
      </div>
    </div>
  );
}
