import { redirect } from "next/navigation";

/** /tools has no page of its own: the tools are listed on the blog index. */
export default function ToolsIndex(): never {
  redirect("/blog");
}
