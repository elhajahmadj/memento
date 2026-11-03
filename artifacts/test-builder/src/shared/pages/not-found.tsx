import { Card, CardContent } from "@/shared/ui/card";
import { AlertCircle } from "lucide-react";
import { Footer } from "@/shared/ui/shell/footer";

export default function NotFound() {
  return (
    <div
      className="min-h-screen w-full flex flex-col bg-background text-foreground"
      data-testid="page-not-found"
    >
      <div className="flex-1 flex items-center justify-center">
        <Card className="w-full max-w-md mx-4 border-card-border">
          <CardContent className="pt-6">
            <div className="flex mb-4 gap-2">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <h1 className="text-2xl font-bold">404 Page Not Found</h1>
            </div>

            <p className="mt-4 text-sm text-muted-foreground">
              Did you forget to add the page to the router?
            </p>
          </CardContent>
        </Card>
      </div>
      <Footer />
    </div>
  );
}
