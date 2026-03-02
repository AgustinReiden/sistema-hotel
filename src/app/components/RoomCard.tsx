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

    // Fallback image based on room type
    const defaultLocalImage = room.room_type.toLowerCase().includes("suite")
        ? "/images/suite-fallback.jpg" // Local fallback
        : "/images/room-fallback.jpg"; // Local fallback

    // Unsplash as secondary fallback if local is not setup, but safely checked
    const defaultImageUrl = defaultLocalImage;

    const validImageSrc = isAllowedHost(room.image_url) ? room.image_url! : defaultImageUrl;

    const totalCapacity = room.capacity_adults + room.capacity_children;

    return (
        <>
            <div className="bg-white border text-left border-slate-200 shadow-sm hover:shadow-2xl transition-all duration-500 flex flex-col h-full group">
                <div className="h-64 bg-slate-100 relative overflow-hidden">
                    {validImageSrc.startsWith('/') ? (
                        <div className="absolute inset-0 bg-slate-200 flex flex-col items-center justify-center text-slate-400">
                            <span className="text-xs font-bold uppercase tracking-widest">{room.room_type}</span>
                            <span className="text-[10px]">Sin Imagen</span>
                        </div>
                    ) : (
                        <Image
                            src={validImageSrc}
                            alt={`Room ${room.room_number}`}
                            fill
                            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                            className="object-cover group-hover:scale-105 transition-transform duration-700 ease-out"
                        />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 to-transparent"></div>

                    <div className="absolute bottom-4 left-6">
                        <span className="text-white text-xs font-bold tracking-widest uppercase bg-slate-900/40 backdrop-blur-md px-3 py-1 border border-white/20">
                            Num {room.room_number}
                        </span>
                    </div>
                </div>

                <div className="p-8 flex flex-col flex-1 divide-y divide-slate-100">
                    <div className="pb-6">
                        <h3 className="text-2xl font-serif text-slate-900 mb-3 capitalize">{room.room_type}</h3>
                        <p className="text-slate-500 font-light text-sm line-clamp-3">
                            {room.description || "Una habitación perfectamente equipada para garantizar una estancia placentera e inolvidable."}
                        </p>
                    </div>

                    <div className="py-6 flex flex-col gap-3 text-sm text-slate-600 font-light">
                        <div className="flex items-center gap-3">
                            <Users size={18} className="text-slate-400" />
                            <span>Hasta {totalCapacity} Ocupantes ({room.capacity_adults} Ad. + {room.capacity_children} Niñ.)</span>
                        </div>
                        <div className="flex items-center gap-3">
                            <BedDouble size={18} className="text-slate-400" />
                            <span>{room.beds_configuration}</span>
                        </div>
                        {room.amenities.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-2">
                                {room.amenities.slice(0, 3).map(am => (
                                    <span key={am} className="text-[10px] font-bold tracking-wider uppercase text-slate-500 bg-slate-100 px-2 py-1 rounded-sm">
                                        {am.replace("_", " ")}
                                    </span>
                                ))}
                                {room.amenities.length > 3 && <span className="text-[10px] font-bold text-slate-400">+{room.amenities.length - 3}</span>}
                            </div>
                        )}
                    </div>

                    <div className="mt-auto pt-6 flex items-center justify-between">
                        <div className="text-sm font-semibold tracking-wide">
                            {isAvailable ? (
                                <span className="text-brand-600 flex items-center gap-1.5 uppercase text-xs">
                                    <span className="w-1.5 h-1.5 bg-brand-500 rounded-full animate-pulse"></span>
                                    Libre
                                </span>
                            ) : (
                                <span className="text-slate-400 uppercase text-xs">No Disponible</span>
                            )}
                        </div>
                        {isAvailable ? (
                            <button
                                onClick={() => setIsModalOpen(true)}
                                className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-3 text-sm font-bold uppercase tracking-wider transition-colors cursor-pointer"
                            >
                                Reservar
                            </button>
                        ) : (
                            <span className="px-6 py-3 text-sm font-bold uppercase tracking-wider bg-slate-100 text-slate-400 cursor-not-allowed">
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
