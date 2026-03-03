"use client";

import { useState } from "react";
import Image from "next/image";
import { Users, BedDouble } from "lucide-react";
import { Room } from "@/lib/types";
import BookingModal from "./BookingModal";

interface RoomCardProps {
    room: Room;
    checkIn: string;
    checkOut: string;
    isAvailable: boolean;
    checkInTime?: string;
    checkOutTime?: string;
    timezone?: string;
}

export default function RoomCard({ room, checkIn, checkOut, isAvailable, checkInTime = "14:00", checkOutTime = "10:00", timezone = "America/Argentina/Tucuman" }: RoomCardProps) {
    const [isModalOpen, setIsModalOpen] = useState(false);

    const isAllowedHost = (url: string | null) => {
        if (!url) return false;
        if (url.startsWith('/')) return true;
        try {
            const hostname = new URL(url).hostname;
            return ['images.unsplash.com', 'postimg.cc', 'i.postimg.cc', 'imgur.com', 'i.imgur.com'].includes(hostname);
        } catch {
            return false;
        }
    };

    const defaultLocalImage = room.room_type.toLowerCase().includes("suite")
        ? "/images/suite-fallback.jpg"
        : "/images/room-fallback.jpg";

    const defaultImageUrl = defaultLocalImage;
    const validImageSrc = isAllowedHost(room.image_url) ? room.image_url! : defaultImageUrl;
    const totalCapacity = room.capacity_adults + room.capacity_children;

    return (
        <>
            <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-500 flex flex-col h-full group overflow-hidden text-left">
                {/* Imagen */}
                <div className="h-60 bg-slate-100 relative overflow-hidden">
                    {validImageSrc.startsWith('/') ? (
                        <div className="absolute inset-0 bg-gradient-to-br from-slate-200 to-slate-100 flex flex-col items-center justify-center text-slate-400 gap-1">
                            <BedDouble size={32} className="text-slate-300" />
                            <span className="text-xs font-bold uppercase tracking-widest">{room.room_type}</span>
                        </div>
                    ) : (
                        <Image
                            src={validImageSrc}
                            alt={`Habitaci\u00f3n ${room.room_number}`}
                            fill
                            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                            className="object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                        />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900/50 via-transparent to-transparent"></div>

                    {/* Badge numero de habitacion */}
                    <div className="absolute top-4 left-4">
                        <span className="text-white text-[11px] font-bold tracking-widest uppercase bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10">
                            N&deg; {room.room_number}
                        </span>
                    </div>

                    {/* Precio sobre la imagen */}
                    <div className="absolute bottom-4 right-4">
                        <span className="text-white text-lg font-bold bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-lg border border-white/10">
                            ${room.base_price.toLocaleString("es-AR")}
                            <span className="text-white/70 text-xs font-normal ml-1">/noche</span>
                        </span>
                    </div>
                </div>

                {/* Info */}
                <div className="p-6 flex flex-col flex-1">
                    <div className="mb-4">
                        <h3 className="text-xl font-serif text-slate-900 mb-2 capitalize">{room.room_type}</h3>
                        <p className="text-slate-500 font-light text-sm line-clamp-2 leading-relaxed">
                            {room.description || "Habitaci\u00f3n equipada para una estancia c\u00f3moda y tranquila."}
                        </p>
                    </div>

                    <div className="flex flex-col gap-2.5 text-sm text-slate-500 font-light mb-5">
                        <div className="flex items-center gap-2.5">
                            <Users size={16} className="text-slate-400" />
                            <span>Hasta {totalCapacity} personas</span>
                        </div>
                        <div className="flex items-center gap-2.5">
                            <BedDouble size={16} className="text-slate-400" />
                            <span>{room.beds_configuration}</span>
                        </div>
                    </div>

                    {room.amenities.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-5">
                            {room.amenities.slice(0, 4).map(am => (
                                <span key={am} className="text-[10px] font-semibold tracking-wider uppercase text-slate-500 bg-slate-100 px-2.5 py-1 rounded-md">
                                    {am.replace("_", " ")}
                                </span>
                            ))}
                            {room.amenities.length > 4 && <span className="text-[10px] font-semibold text-slate-400 self-center">+{room.amenities.length - 4}</span>}
                        </div>
                    )}

                    {/* Accion */}
                    <div className="mt-auto pt-4 border-t border-slate-100 flex items-center justify-between">
                        <div className="text-sm font-semibold tracking-wide">
                            {isAvailable ? (
                                <span className="text-brand-600 flex items-center gap-1.5 uppercase text-xs font-bold">
                                    <span className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-pulse"></span>
                                    Disponible
                                </span>
                            ) : (
                                <span className="text-slate-400 uppercase text-xs">No Disponible</span>
                            )}
                        </div>
                        {isAvailable ? (
                            <button
                                onClick={() => setIsModalOpen(true)}
                                className="bg-slate-900 hover:bg-slate-800 text-white px-5 py-2.5 text-sm font-bold uppercase tracking-wider rounded-lg transition-all hover:shadow-lg cursor-pointer"
                            >
                                Reservar
                            </button>
                        ) : (
                            <span className="px-5 py-2.5 text-sm font-bold uppercase tracking-wider bg-slate-100 text-slate-400 rounded-lg cursor-not-allowed">
                                Ocupada
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
