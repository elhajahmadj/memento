import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("wouter", () => ({
  useLocation: () => ["/oops", vi.fn()],
  Link: ({ children, href, ...rest }: { children: ReactNode; href?: string } & Record<string, unknown>) =>
    <a href={href} {...rest}>{children}</a>,
}));

import NotFound from "../not-found";

afterEach(() => cleanup());

describe("<NotFound />", () => {
  it("renders the 404 message", () => {
    render(<NotFound />);
    expect(screen.getByText("404 Page Not Found")).toBeDefined();
    expect(
      screen.getByText(/Did you forget to add the page to the router/i),
    ).toBeDefined();
  });

  it("includes the footer tech stack", () => {
    render(<NotFound />);
    expect(screen.getByTestId("footer-tech-stack")).toBeDefined();
  });
});
