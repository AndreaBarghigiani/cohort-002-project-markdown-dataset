import { TopBar } from "@/components/top-bar";
import { SearchInput } from "./search-input";
import { DocList } from "./doc-list";
import { SearchPagination } from "./search-pagination";
import { PerPageSelector } from "./per-page-selector";
import { loadChats, loadMemories } from "@/lib/persistence-layer";
import { CHAT_LIMIT } from "../page";
import { SideBar } from "@/components/side-bar";
import { loadVaultDocs, searchWithBM25 } from "@/app/search";

export default async function SearchPage(props: {
  searchParams: Promise<{ q?: string; page?: string; perPage?: string }>;
}) {
  const searchParams = await props.searchParams;
  const query = searchParams.q || "";
  const page = Number(searchParams.page) || 1;
  const perPage = Number(searchParams.perPage) || 10;

  const allDocs = await loadVaultDocs();

  const docsWithScores = searchWithBM25(
    query.toLowerCase().split(" "),
    allDocs
  );

  // Transform docs to match the expected format
  const transformedDocs = docsWithScores
    .map(({ doc, score }) => ({
      id: doc.id,
      from: doc.from,
      subject: doc.subject,
      preview: doc.content.substring(0, 100) + "...",
      content: doc.content,
      date: doc.timestamp,
      score,
    }))
    .sort((a, b) => b.score - a.score);

  // Filter docs based on search query
  const filteredDocs = query
    ? transformedDocs.filter((email) => email.score > 0)
    : transformedDocs;

  const totalPages = Math.ceil(filteredDocs.length / perPage);
  const startIndex = (page - 1) * perPage;
  const paginatedDocs = filteredDocs.slice(startIndex, startIndex + perPage);
  const allChats = await loadChats();
  const chats = allChats.slice(0, CHAT_LIMIT);
  const memories = await loadMemories();

  return (
    <>
      <SideBar chats={chats} memories={memories} chatIdFromSearchParams={""} />
      <div className="h-screen flex flex-col w-full">
        <TopBar showSidebar={true} title="Data" />
        <div className="flex-1">
          <div className="max-w-4xl mx-auto xl:px-2 px-6 py-6">
            <div className="mb-6">
              <p className="text-sm text-muted-foreground">
                Browse your markdown docs
              </p>
            </div>

            <div className="flex md:items-center md:justify-between gap-4 flex-col md:flex-row">
              <SearchInput initialQuery={query} currentPerPage={perPage} />
              <PerPageSelector currentPerPage={perPage} query={query} />
            </div>

            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-muted-foreground">
                  {query ? (
                    <>
                      Found {filteredDocs.length} result
                      {filteredDocs.length !== 1 ? "s" : ""} for &ldquo;
                      {query}
                      &rdquo;
                    </>
                  ) : (
                    <>Found {filteredDocs.length} docs</>
                  )}
                </p>
              </div>
              <DocList docs={paginatedDocs} />
              {totalPages > 1 && (
                <div className="mt-6">
                  <SearchPagination
                    currentPage={page}
                    totalPages={totalPages}
                    query={query}
                    perPage={perPage}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
