import { SearchResults } from "@/components/search-results";

interface SearchPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const value = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = value?.trim() ?? "";
  return <SearchResults key={query} query={query} />;
}
