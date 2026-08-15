import PageHeader from "@/components/PageHeader";
import PhotoFinderPanel from "@/components/PhotoFinderPanel";

export default function PhotoSearch() {
  return (
    <div>
      <PageHeader
        title="Photo Search"
        subtitle="Find railcar photos by reporting mark and number"
      />
      <div className="px-4 sm:px-8 py-5 sm:py-8 max-w-3xl">
        <PhotoFinderPanel />
      </div>
    </div>
  );
}
