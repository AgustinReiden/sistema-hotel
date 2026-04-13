"use client";

import { useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { PublicRoomOffer } from "@/lib/types";
import RoomCard from "./RoomCard";

interface RoomCarouselProps {
  offers: PublicRoomOffer[];
  checkIn: string;
  checkOut: string;
  checkInTime?: string;
  checkOutTime?: string;
  timezone?: string;
}

export default function RoomCarousel({
  offers,
  checkIn,
  checkOut,
  checkInTime,
  checkOutTime,
  timezone,
}: RoomCarouselProps) {
  const [emblaRef, emblaApi] = useEmblaCarousel({
    align: "start",
    slidesToScroll: "auto",
    containScroll: "trimSnaps",
    loop: false,
  });

  const [canScrollPrev, setCanScrollPrev] = useState(false);
  const [canScrollNext, setCanScrollNext] = useState(false);

  useEffect(() => {
    if (!emblaApi) return;
    const syncScrollButtons = () => {
      setCanScrollPrev(emblaApi.canScrollPrev());
      setCanScrollNext(emblaApi.canScrollNext());
    };

    emblaApi.on("select", syncScrollButtons);
    emblaApi.on("reInit", syncScrollButtons);
    emblaApi.emit("select");

    return () => {
      emblaApi.off("select", syncScrollButtons);
      emblaApi.off("reInit", syncScrollButtons);
    };
  }, [emblaApi]);

  const showArrows = offers.length > 3;

  return (
    <div className="relative">
      {/* Embla viewport */}
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex gap-8">
          {offers.map((offer) => (
            <div
              key={offer.id}
              className="min-w-0 flex-shrink-0 basis-full md:basis-[calc(50%-1rem)] lg:basis-[calc(33.333%-1.334rem)]"
            >
              <RoomCard
                offer={offer}
                checkIn={checkIn}
                checkOut={checkOut}
                checkInTime={checkInTime}
                checkOutTime={checkOutTime}
                timezone={timezone}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Flechas de navegación */}
      {showArrows && (
        <>
          <button
            onClick={() => emblaApi?.scrollPrev()}
            disabled={!canScrollPrev}
            className="absolute -left-5 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center text-white hover:bg-white/25 transition-all duration-300 disabled:opacity-0 disabled:pointer-events-none shadow-lg cursor-pointer"
            aria-label="Habitaciones anteriores"
          >
            <ChevronLeft size={22} />
          </button>
          <button
            onClick={() => emblaApi?.scrollNext()}
            disabled={!canScrollNext}
            className="absolute -right-5 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-white/15 backdrop-blur-md border border-white/20 flex items-center justify-center text-white hover:bg-white/25 transition-all duration-300 disabled:opacity-0 disabled:pointer-events-none shadow-lg cursor-pointer"
            aria-label="Siguientes habitaciones"
          >
            <ChevronRight size={22} />
          </button>
        </>
      )}
    </div>
  );
}
