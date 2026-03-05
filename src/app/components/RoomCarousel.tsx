"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Room } from "@/lib/types";
import RoomCard from "./RoomCard";

interface RoomCarouselProps {
  rooms: Room[];
  checkIn: string;
  checkOut: string;
  availableRoomIds: number[];
  checkInTime?: string;
  checkOutTime?: string;
  timezone?: string;
}

export default function RoomCarousel({
  rooms,
  checkIn,
  checkOut,
  availableRoomIds,
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

  const availableSet = useMemo(() => new Set(availableRoomIds), [availableRoomIds]);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setCanScrollPrev(emblaApi.canScrollPrev());
    setCanScrollNext(emblaApi.canScrollNext());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    emblaApi.on("reInit", onSelect);
    return () => {
      emblaApi.off("select", onSelect);
      emblaApi.off("reInit", onSelect);
    };
  }, [emblaApi, onSelect]);

  const showArrows = rooms.length > 3;

  return (
    <div className="relative">
      {/* Embla viewport */}
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex gap-8">
          {rooms.map((room) => (
            <div
              key={room.id}
              className="min-w-0 flex-shrink-0 basis-full md:basis-[calc(50%-1rem)] lg:basis-[calc(33.333%-1.334rem)]"
            >
              <RoomCard
                room={room}
                checkIn={checkIn}
                checkOut={checkOut}
                isAvailable={availableSet.has(room.id)}
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
