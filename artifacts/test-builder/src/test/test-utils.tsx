import { type ReactElement, type ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface ProviderOptions {
  initialPath?: string | undefined;
  queryClient?: QueryClient | undefined;
}

export function withProviders(
  ui: ReactNode,
  { initialPath = "/", queryClient }: ProviderOptions = {},
) {
  const qc = queryClient ?? makeQueryClient();
  const { hook } = memoryLocation({ path: initialPath, record: true });
  return (
    <QueryClientProvider client={qc}>
      <Router hook={hook}>{ui}</Router>
    </QueryClientProvider>
  );
}

export function renderWithProviders(
  ui: ReactElement,
  options: ProviderOptions & RenderOptions = {},
) {
  const { initialPath, queryClient, ...renderOptions } = options;
  return render(withProviders(ui, { initialPath, queryClient }), renderOptions);
}
