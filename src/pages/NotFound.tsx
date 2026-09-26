import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Link } from "react-router";

export default function NotFound() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="flex min-h-screen flex-col items-center justify-center px-4"
    >
      <div className="text-center">
        <p className="font-title text-6xl font-bold tracking-tight">404</p>
        <p className="mt-2 text-lg text-muted-foreground">Page not found</p>
        <p className="mt-1 text-sm text-muted-foreground">
          The page you asked for does not exist.
        </p>
        <div className="mt-6">
          <Button asChild>
            <Link to="/">Back to the vaccination dashboard</Link>
          </Button>
        </div>
      </div>
    </motion.div>
  );
}
