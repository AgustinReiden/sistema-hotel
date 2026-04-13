"use client";

import { useState } from "react";
import Image from "next/image";
import { Users, BedDouble, Layers3 } from "lucide-react";
import { PublicRoomOffer } from "@/lib/types";
import BookingModal from "./BookingModal";

interface RoomCardProps {
  offer: PublicRoomOffer;
  checkIn: string;
  checkOut: string;
  checkInTime?: string;
  checkOutTime?: string;
  timezone?: string;
}

function getOfferCountLabel(offer: PublicRoomOffer) {
  if (offer.mode === "catalog") {
    return `${offer.roomCount} ${offer.roomCount === 1 ? "habitacion" : "habitaciones"}`;
  }

  if (offer.mode === "combination") {
    return `${offer.roomCount} ${offer.roomCount === 1 ? "unidad" : "unidades"} en la combinacion`;
  }

  return offer.roomCount === 1
    ? "1 unidad disponible"
    : `${offer.roomCount} unidades disponibles`;
}

export default function RoomCard({
  offer,
  checkIn,
  checkOut,
  checkInTime = "14:00",
  checkOutTime = "10:00",
  timezone = "America/Argentina/Tucuman",
}: RoomCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const room = offer.representativeRoom;
  const canReserve = offer.mode === "available" && Boolean(checkIn) && Boolean(checkOut);

  const isAllowedHost = (url: string | null) => {
    if (!url) return false;
    if (url.startsWith("/")) return true;
    try {
      const hostname = new URL(url).hostname;
      return ["images.unsplash.com", "postimg.cc", "i.postimg.cc", "imgur.com", "i.imgur.com"].includes(
        hostname
      );
    } catch {
      return false;
    }
  };

  const defaultLocalImage = offer.roomType.toLowerCase().includes("suite")
    ? "/images/suite-fallback.jpg"
    : "/images/room-fallback.jpg";

  const validImageSrc = isAllowedHost(offer.imageUrl) ? offer.imageUrl! : defaultLocalImage;

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-500 flex flex-col h-full group overflow-hidden text-left">
        <div className="h-60 bg-slate-100 relative overflow-hidden">
          {validImageSrc.startsWith("/") ? (
            <div className="absolute inset-0 bg-gradient-to-br from-slate-200 to-slate-100 flex flex-col items-center justify-center text-slate-400 gap-1">
              <BedDouble size={32} className="text-slate-300" />
              <span className="text-xs font-bold uppercase tracking-widest">{offer.roomType}</span>
            </div>
          ) : (
            <Image
              src={validImageSrc}
              alt={`Categoria ${offer.roomType}`}
              fill
              sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              className="object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-900/50 via-transparent to-transparent"></div>

          <div className="absolute top-4 left-4">
            <span className="text-white text-[11px] font-bold tracking-widest uppercase bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10">
              {getOfferCountLabel(offer)}
            </span>
          </div>

          <div className="absolute bottom-4 right-4">
            <span className="text-white text-lg font-bold bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10">
              Desde ${offer.priceFrom.toLocaleString("es-AR")}
              <span className="text-white/70 text-xs font-normal ml-1">/noche</span>
            </span>
          </div>
        </div>

        <div className="p-6 flex flex-col flex-1">
          <div className="mb-4">
            <h3 className="text-xl font-serif text-slate-900 mb-2 capitalize">{offer.roomType}</h3>
            <p className="text-slate-500 font-light text-sm line-clamp-2 leading-relaxed">
              {offer.description || "Habitacion equipada para una estancia comoda y tranquila."}
            </p>
          </div>

          <div className="flex flex-col gap-2.5 text-sm text-slate-500 font-light mb-5">
            <div className="flex items-center gap-2.5">
              <Users size={16} className="text-slate-400" />
              <span>Hasta {offer.maxCapacity} personas</span>
            </div>
            <div className="flex items-center gap-2.5">
              <BedDouble size={16} className="text-slate-400" />
              <span>{offer.bedsSummary}</span>
            </div>
            <div className="flex items-center gap-2.5">
              <Layers3 size={16} className="text-slate-400" />
              <span>{getOfferCountLabel(offer)}</span>
            </div>
          </div>

          {offer.amenities.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-5">
              {offer.amenities.slice(0, 4).map((amenity) => (
                <span
                  key={amenity}
                  className="text-[10px] font-semibold tracking-wider uppercase text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md"
                >
                  {amenity.replace("_", " ")}
                </span>
              ))}
              {offer.amenities.length > 4 && (
                <span className="text-[10px] font-semibold text-slate-400 self-center">
                  +{offer.amenities.length - 4}
                </span>
              )}
            </div>
          )}

          <div className="mt-auto pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
            <div className="text-xs font-semibold tracking-wide uppercase text-slate-400">
              {offer.mode === "catalog" && "Elegi fechas para ver disponibilidad"}
              {offer.mode === "available" && "Reserva por categoria"}
              {offer.mode === "combination" && "Combinacion sugerida"}
            </div>

            {canReserve ? (
              <button
                onClick={() => setIsModalOpen(true)}
                className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 text-sm font-bold uppercase tracking-wider rounded-lg transition-all hover:shadow-lg cursor-pointer"
              >
                Reservar
              </button>
            ) : offer.mode === "catalog" ? (
              <a
                href="#buscar-fechas"
                className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 text-sm font-bold uppercase tracking-wider rounded-lg transition-all hover:shadow-lg"
              >
                Ver disponibilidad
              </a>
            ) : (
              <span className="px-5 py-2.5 text-sm font-bold uppercase tracking-wider bg-slate-100 text-slate-500 rounded-lg">
                Coordinar
              </span>
            )}
          </div>
        </div>
      </div>

      <BookingModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        room={room}
        checkIn={checkIn}
        checkOut={checkOut}
        imageSrc={validImageSrc}
        checkInTime={checkInTime}
        checkOutTime={checkOutTime}
        timezone={timezone}
      />
    </>
  );
}
