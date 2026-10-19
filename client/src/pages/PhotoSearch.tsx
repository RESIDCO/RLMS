import PageHeader from "@/components/PageHeader";
import PhotoFinderPanel from "@/components/PhotoFinderPanel";

export default function PhotoSearch() {
  return (
    <div>
      <PageHeader
        title="Photo Search"
        subtitle="Find railcar photos by reporting mark and number"
      />
      <div className="min-w-0 max-w-5xl px-4 py-5 sm:px-8 sm:py-8">
        <PhotoFinderPanel />
      </div>
    </div>
  );
}
