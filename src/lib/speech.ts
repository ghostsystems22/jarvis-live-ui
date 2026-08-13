export function speechText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, 'Code output omitted.')
    .replace(/[`*_#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2400);
}
