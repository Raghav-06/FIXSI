import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md py-20 text-center">
      <h1 className="text-lg font-semibold">Page not found</h1>
      <Link to="/" className="btn-primary mt-6">Back to Fixsi</Link>
    </div>
  );
}
