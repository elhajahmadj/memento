import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  useGetAiAgentCatalog,
  useCreateAiAgentCatalogMethod,
  useDeleteAiAgentCatalogMethod,
  useCreateAiAgentCatalogSelector,
  useDeleteAiAgentCatalogSelector,
  useCreateAiAgentCatalogCategory,
  useDeleteAiAgentCatalogCategory,
  getGetAiAgentCatalogQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/shared/ui/tabs";

export function CatalogTab({ projectName }: { projectName: string }) {
  const qc = useQueryClient();
  const key = getGetAiAgentCatalogQueryKey(projectName);
  const { data, isLoading } = useGetAiAgentCatalog(projectName, {
    query: { queryKey: key },
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: key });
  const addMethod = useCreateAiAgentCatalogMethod({
    mutation: { onSuccess: invalidate },
  });
  const delMethod = useDeleteAiAgentCatalogMethod({
    mutation: { onSuccess: invalidate },
  });
  const addSelector = useCreateAiAgentCatalogSelector({
    mutation: { onSuccess: invalidate },
  });
  const delSelector = useDeleteAiAgentCatalogSelector({
    mutation: { onSuccess: invalidate },
  });
  const addCategory = useCreateAiAgentCatalogCategory({
    mutation: { onSuccess: invalidate },
  });
  const delCategory = useDeleteAiAgentCatalogCategory({
    mutation: { onSuccess: invalidate },
  });
  const [mName, setMName] = useState("");
  const [mSig, setMSig] = useState("");
  const [sName, setSName] = useState("");
  const [sSel, setSSel] = useState("");
  const [cName, setCName] = useState("");

  if (isLoading) {
    return (
      <div className="flex items-center text-muted-foreground py-4">
        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading catalog…
      </div>
    );
  }

  return (
    <Tabs defaultValue="methods" className="mt-2">
      <TabsList>
        <TabsTrigger value="methods" data-testid="tab-ai-methods">
          Methods ({data?.methods.length ?? 0})
        </TabsTrigger>
        <TabsTrigger value="selectors" data-testid="tab-ai-selectors">
          Selectors ({data?.selectors.length ?? 0})
        </TabsTrigger>
        <TabsTrigger value="categories" data-testid="tab-ai-categories">
          Categories ({data?.categories.length ?? 0})
        </TabsTrigger>
      </TabsList>

      <TabsContent value="methods" className="space-y-3 mt-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input
            value={mName}
            onChange={(e) => setMName(e.target.value)}
            placeholder="login"
            data-testid="input-ai-method-name"
          />
          <Input
            value={mSig}
            onChange={(e) => setMSig(e.target.value)}
            placeholder="login(user, pass)"
            className="md:col-span-2"
            data-testid="input-ai-method-sig"
          />
        </div>
        <Button
          size="sm"
          disabled={!mName.trim() || !mSig.trim() || addMethod.isPending}
          onClick={() =>
            addMethod.mutate({
              projectName,
              data: { name: mName.trim(), signature: mSig.trim() },
            }, {
              onSuccess: () => { setMName(""); setMSig(""); },
            })
          }
          data-testid="button-add-ai-method"
        >
          Add method
        </Button>
        <ul className="space-y-1">
          {data?.methods.map((m) => (
            <li key={m.id} className="flex items-center justify-between border rounded-md px-3 py-2">
              <div className="font-mono text-xs">
                <span className="font-semibold">{m.name}</span>{" "}
                <span className="text-muted-foreground">{m.signature}</span>
                <span className="ml-2 text-[10px] uppercase text-muted-foreground">{m.source}</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => delMethod.mutate({ projectName, id: m.id })}
                data-testid={`button-del-method-${m.id}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </TabsContent>

      <TabsContent value="selectors" className="space-y-3 mt-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Input
            value={sName}
            onChange={(e) => setSName(e.target.value)}
            placeholder="login button"
            data-testid="input-ai-selector-name"
          />
          <Input
            value={sSel}
            onChange={(e) => setSSel(e.target.value)}
            placeholder="data-testid=button-login"
            className="md:col-span-2"
            data-testid="input-ai-selector-value"
          />
        </div>
        <Button
          size="sm"
          disabled={!sName.trim() || !sSel.trim() || addSelector.isPending}
          onClick={() =>
            addSelector.mutate({
              projectName,
              data: { name: sName.trim(), selector: sSel.trim() },
            }, {
              onSuccess: () => { setSName(""); setSSel(""); },
            })
          }
          data-testid="button-add-ai-selector"
        >
          Add selector
        </Button>
        <ul className="space-y-1">
          {data?.selectors.map((s) => (
            <li key={s.id} className="flex items-center justify-between border rounded-md px-3 py-2">
              <div className="font-mono text-xs">
                <span className="font-semibold">{s.name}</span>{" "}
                <span className="text-muted-foreground">{s.selector}</span>
                <span className="ml-2 text-[10px] uppercase text-muted-foreground">{s.source}</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => delSelector.mutate({ projectName, id: s.id })}
                data-testid={`button-del-selector-${s.id}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </TabsContent>

      <TabsContent value="categories" className="space-y-3 mt-3">
        <div className="flex gap-2">
          <Input
            value={cName}
            onChange={(e) => setCName(e.target.value)}
            placeholder="smoke"
            data-testid="input-ai-category-name"
          />
          <Button
            size="sm"
            disabled={!cName.trim() || addCategory.isPending}
            onClick={() =>
              addCategory.mutate({
                projectName,
                data: { name: cName.trim() },
              }, {
                onSuccess: () => setCName(""),
              })
            }
            data-testid="button-add-ai-category"
          >
            Add
          </Button>
        </div>
        <ul className="space-y-1">
          {data?.categories.map((c) => (
            <li key={c.id} className="flex items-center justify-between border rounded-md px-3 py-2">
              <div className="font-mono text-xs">
                <span className="font-semibold">{c.name}</span>
                <span className="ml-2 text-[10px] uppercase text-muted-foreground">{c.source}</span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => delCategory.mutate({ projectName, id: c.id })}
                data-testid={`button-del-category-${c.id}`}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </TabsContent>
    </Tabs>
  );
}
