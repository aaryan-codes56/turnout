import { brand } from "@/lib/brand";

/** The landing page's one piece of decoration: a stub getting stamped. */
export function AdmitStub() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-md -rotate-2">
      <div className="ticket-stub relative grid aspect-[16/9] grid-cols-[74%_26%] bg-stub text-foreground">
        <div className="flex flex-col justify-between p-5 sm:p-7">
          <p className="font-bold">Your club&apos;s next event</p>
          <p className="font-heading text-[clamp(3.25rem,15vw,5.5rem)] leading-none font-black">
            Admit one
          </p>
        </div>
        <div className="flex items-start justify-center pt-5">
          <p className="font-heading text-2xl font-extrabold [writing-mode:vertical-rl]">
            {brand.name}
          </p>
        </div>
        <div className="ticket-tear absolute inset-y-4 border-l-2 border-dashed border-foreground/45" />
      </div>
      <p className="door-stamp absolute right-[9%] bottom-[8%] rounded-md border-4 border-foreground px-3 py-1 font-heading text-3xl font-black text-foreground mix-blend-multiply sm:text-4xl">
        Checked in
      </p>
    </div>
  );
}
