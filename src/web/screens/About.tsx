import { BuilderCard } from '../components/BuilderCard';

export function About() {
  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="text-2xl font-semibold">About</h1>
      <p>
        Promo Finder reads timestamped microdrama screenplays and shortlists promo clips for an editor to review. It builds every candidate from script entries, so timestamps land on real beats. It scores the hook, the cliffhanger and whether a newcomer can follow, then removes overlaps and ranks what is left.
      </p>
      <p className="text-muted">
        It works from the script alone. It never sees the video, so an editor reviews the top 10. All processing happens in your browser. Nothing is uploaded unless you turn on a model provider.
      </p>
      <BuilderCard />
    </div>
  );
}
