import { useParams } from "react-router-dom";

import { RunView } from "../components/RunView";

export default function Run() {
  const { id } = useParams();
  return <RunView key={id} runId={id} />;
}
