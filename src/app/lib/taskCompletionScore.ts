export type TaskCompletionGrade = "A" | "B" | "C" | "D";

export function getGradeTone(grade: TaskCompletionGrade): {
  bg: string;
  text: string;
  border: string;
  ring: string;
  bar: string;
} {
  switch (grade) {
    case "A":
      return {
        bg: "bg-emerald-50",
        text: "text-emerald-700",
        border: "border-emerald-200",
        ring: "ring-emerald-200",
        bar: "bg-emerald-500",
      };
    case "B":
      return {
        bg: "bg-blue-50",
        text: "text-blue-700",
        border: "border-blue-200",
        ring: "ring-blue-200",
        bar: "bg-blue-500",
      };
    case "C":
      return {
        bg: "bg-amber-50",
        text: "text-amber-700",
        border: "border-amber-200",
        ring: "ring-amber-200",
        bar: "bg-amber-500",
      };
    case "D":
      return {
        bg: "bg-rose-50",
        text: "text-rose-700",
        border: "border-rose-200",
        ring: "ring-rose-200",
        bar: "bg-rose-500",
      };
  }
}
