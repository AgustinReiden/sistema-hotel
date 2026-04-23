"use client";

import { useState } from "react";
import NewReservationModal from "./NewReservationModal";
import { handleCreateReservation } from "./actions";
import type { AssociatedClient, Room } from "@/lib/types";

type NewReservationButtonProps = {
    rooms: Room[];
    associatedClients: AssociatedClient[];
    standardCheckInTime?: string;
    standardCheckOutTime?: string;
};

export default function NewReservationButton({
    rooms,
    associatedClients,
    standardCheckInTime,
    standardCheckOutTime,
}: NewReservationButtonProps) {
    const [isModalOpen, setIsModalOpen] = useState(false);

    return (
        <>
            <button
                onClick={() => setIsModalOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 rounded-lg font-medium transition-all shadow-md shadow-emerald-600/20 active:scale-95"
            >
                + Nueva Reserva
            </button>

            <NewReservationModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                rooms={rooms}
                associatedClients={associatedClients}
                standardCheckInTime={standardCheckInTime}
                standardCheckOutTime={standardCheckOutTime}
                onSubmit={async (data) => {
                    return await handleCreateReservation(data);
                }}
            />
        </>
    );
}
