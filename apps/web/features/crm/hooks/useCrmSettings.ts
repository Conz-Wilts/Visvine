"use client";

import { useEffect, useState } from "react";
import { FieldDefinition } from "@/lib/schemas/crm";

export function useCrmSettings(communityId: string) {
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/crm/${communityId}/settings`)
      .then((r) => (r.ok ? r.json() : { fields: [] }))
      .then((data) => setFields(data.fields ?? []))
      .catch(() => setFields([]))
      .finally(() => setLoading(false));
  }, [communityId]);

  return { fields, loading };
}
