import Link from "next/link";
import Image from "next/image";
import { Star, MapPin, Coffee, Check, Instagram, Phone } from "lucide-react";
import PublicSearchForm from "./components/PublicSearchForm";
import RoomCard from "./components/RoomCard";
import { getAllRooms, getAvailableRooms, getHotelSettings } from "@/lib/data";

type PageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const checkin = typeof params.checkin === "string" ? params.checkin : undefined;
  const checkout = typeof params.checkout === "string" ? params.checkout : undefined;
  const guestsParam = typeof params.guests === "string" ? params.guests : undefined;

  const isSearching = !!checkin && !!checkout;

  const allRooms = await getAllRooms();
  const availableRooms = isSearching ? await getAvailableRooms(checkin, checkout, guestsParam) : [];
  const availableRoomIds = new Set(availableRooms.map((r) => r.id));
  const settings = await getHotelSettings();

  let comboMessage: string | null = null;
  const searchGuests = guestsParam ? parseInt(guestsParam, 10) : 0;

  if (isSearching && availableRooms.length > 1 && searchGuests > 0) {
    const typeCounts = new Map<string, number>();
    for (const room of availableRooms) {
      const typeName = room.room_type; // Single, Double, etc.
      typeCounts.set(typeName, (typeCounts.get(typeName) || 0) + 1);
    }
    const parts: string[] = [];
    for (const [type, count] of typeCounts.entries()) {
      parts.push(`${count} habitación ${type}`);
    }
    comboMessage = `No tenemos disponible una sola habitación para ${searchGuests} personas, pero le podemos ofrecer la siguiente opción combinada: ¡${parts.join(" y ")}!`;
  }

  return (
    <div className="min-h-screen bg-stone-50 selection:bg-brand-500 selection:text-white font-sans scroll-smooth">
      {isSearching && (
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.onload = function() {
                var el = document.getElementById('habitaciones');
                if(el) el.scrollIntoView({behavior: 'smooth'});
              }
            `
          }}
        />
      )}
      {/* Navbar Premium */}
      <nav className="absolute w-full z-50 bg-transparent transition-all duration-300">
        <div className="max-w-7xl mx-auto px-6 h-24 flex items-center justify-between">
          <div className="flex items-center gap-4">
            {settings?.logo_url ? (
              <div className="relative w-12 h-12 flex items-center justify-center">
                <Image src={settings.logo_url} alt="Logo" fill className="object-contain" />
              </div>
            ) : (
              <div className="w-10 h-10 bg-white rounded-sm flex items-center justify-center">
                <Star className="text-slate-900 fill-slate-900" size={18} />
              </div>
            )}
            <span className="text-xl font-bold tracking-widest uppercase text-white drop-shadow-sm">
              {settings?.name || "The Hotel"}
            </span>
          </div>

          <div className="hidden md:flex gap-10 items-center text-sm font-semibold tracking-wide text-white/90 uppercase drop-shadow-sm">
            <a href="#habitaciones" className="hover:text-white transition-colors cursor-pointer">
              Habitaciones
            </a>
            <a href="#servicios" className="hover:text-white transition-colors cursor-pointer">
              Servicios
            </a>
            <a href="#ubicacion" className="hover:text-white transition-colors cursor-pointer">
              Ubicación
            </a>
            <Link
              href="/admin"
              className="px-5 py-2.5 rounded-sm bg-white text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Acceso Staff
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section Premium */}
      <section className="relative min-h-[90vh] flex items-center justify-center pt-20 overflow-hidden">
        {/* Fondo de Alta Calidad */}
        <div className="absolute inset-0 bg-black">
          <Image
            src={settings?.hero_image_url || "https://images.unsplash.com/photo-1545642412-ea820db826a7?auto=format&fit=crop&q=80&w=2000"}
            alt="Hotel Hero"
            fill
            priority
            className="object-cover opacity-80"
          />
          <div className="absolute inset-0 bg-black/40"></div>
          <div className="absolute inset-0 bg-gradient-to-t from-stone-50 via-transparent to-transparent"></div>
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-6 w-full text-center mt-12 mb-32">

          <h1 className="text-5xl md:text-7xl font-serif text-white mb-24 leading-tight drop-shadow-lg">
            {settings?.hero_title || "Donde el lujo se encuentra con la tranquilidad."}
          </h1>

          <div className="max-w-5xl mx-auto transform translate-y-1/2 absolute left-0 right-0 bottom-0 px-6">
            <PublicSearchForm />
          </div>
        </div>
      </section>

      {/* Espaciador para el buscador absolutizado del hero */}
      <div className="h-32 md:h-16"></div>

      {/* Sección Habitaciones rediseñada */}
      <section id="habitaciones" className="py-24 bg-stone-50 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-xs font-bold tracking-widest text-slate-500 uppercase mb-3">Alojamiento</h2>
            <h3 className="text-4xl md:text-5xl font-serif text-slate-900 mb-6">
              {isSearching ? "Disponibilidad" : "Nuestras Habitaciones"}
            </h3>
            <div className="w-24 h-1 bg-brand-500 mx-auto mb-6"></div>
            <p className="text-slate-600 max-w-2xl mx-auto text-lg font-light">
              {isSearching
                ? `Mostrando opciones del ${new Date(`${checkin}T14:00:00Z`).toLocaleDateString()} al ${new Date(`${checkout}T10:00:00Z`).toLocaleDateString()}`
                : "Diseñadas pensando en su confort absoluto. Cada espacio ofrece una perfecta armonía entre diseño contemporáneo y comodidad clásica."}
            </p>
          </div>

          {comboMessage && (
            <div className="max-w-3xl mx-auto mb-10 p-6 bg-brand-50 border border-brand-200 text-brand-800 rounded-xl text-center shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-500">
              <p className="text-lg font-medium">{comboMessage}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
            {isSearching ? (
              availableRooms.length > 0 ? (
                availableRooms.map((room) => (
                  <RoomCard
                    key={room.id}
                    room={room}
                    checkIn={checkin || ""}
                    checkOut={checkout || ""}
                    isAvailable={true}
                  />
                ))
              ) : null
            ) : (
              allRooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  checkIn={checkin || ""}
                  checkOut={checkout || ""}
                  isAvailable={availableRoomIds.has(room.id)}
                />
              ))
            )}
          </div>

          {isSearching && availableRooms.length === 0 && (
            <div className="mt-16 max-w-2xl mx-auto p-10 bg-white border border-slate-200 text-center shadow-sm">
              <h3 className="text-2xl font-serif text-slate-800 mb-3">Sin disponibilidad</h3>
              <p className="text-slate-600 font-light">
                Lamentablemente, nuestras habitaciones están completamente reservadas para las fechas seleccionadas.
                Le invitamos a probar con otro rango de fechas.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Servicios Premium */}
      <section id="servicios" className="py-24 bg-white border-y border-stone-200 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <h2 className="text-xs font-bold tracking-widest text-slate-500 uppercase mb-3">Facilidades</h2>
            <h3 className="text-4xl md:text-5xl font-serif text-slate-900 mb-8">
              Servicios Integrales de Ruta
            </h3>
            <p className="text-slate-600 font-light text-lg mb-10">
              En El Refugio entendemos el valor de tu tiempo y la importancia de un buen descanso. Consolidamos todo lo que necesitás para que tu única preocupación sea volver al camino con energía.
            </p>

            <div className="space-y-6">
              <div className="flex items-start gap-4">
                <div className="mt-1 w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center shrink-0 border border-slate-100">
                  <Coffee size={20} className="text-slate-900" />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-slate-900">Comedor Regional</h4>
                  <p className="text-slate-600 font-light text-sm mt-1">Platos caseros y abundantes con el sabor del norte, ideales para reponer fuerzas en cualquier momento del día.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="mt-1 w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center shrink-0 border border-slate-100">
                  <Star size={20} className="text-slate-900" />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-slate-900">Hotel El Refugio</h4>
                  <p className="text-slate-600 font-light text-sm mt-1">Habitaciones diseñadas para un descanso real, silenciosas y seguras, pensadas específicamente para el viajero y el transportista.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="mt-1 w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center shrink-0 border border-slate-100">
                  <Check size={20} className="text-slate-900" />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-slate-900">Repuestera y Combustibles</h4>
                  <p className="text-slate-600 font-light text-sm mt-1">Carga de combustible de confianza y un stock estratégico de repuestos críticos para resolver cualquier imprevisto mecánico en el acto.</p>
                </div>
              </div>
            </div>
          </div>
          <div className="relative h-[600px] w-full">
            <Image
              src={settings?.services_image_url || "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&q=80&w=1000"}
              alt="Servicios de Hotel"
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover outline outline-1 outline-offset-8 outline-slate-200"
            />
          </div>
        </div>
      </section>

      {/* Footer Minimalista */}
      <footer id="ubicacion" className="bg-slate-950 text-slate-400 py-20 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row gap-12 justify-between">
          <div className="max-w-md">
            <div className="flex items-center gap-3 mb-8">
              {settings?.logo_url ? (
                <div className="relative w-10 h-10 flex items-center justify-center">
                  <Image src={settings.logo_url} alt="Logo" fill className="object-contain" />
                </div>
              ) : (
                <div className="w-8 h-8 bg-white flex items-center justify-center rounded-sm">
                  <Star className="text-slate-900 fill-slate-900" size={16} />
                </div>
              )}
              <span className="text-xl font-bold tracking-widest text-white uppercase">
                {settings?.name || "The Hotel"}
              </span>
            </div>
          </div>

          <div className="text-left md:text-right flex flex-col items-start md:items-end">
            <h4 className="text-white font-bold tracking-widest uppercase text-xs mb-6">Contacto</h4>
            <ul className="space-y-4 font-light text-sm">
              <li className="flex items-center justify-start md:justify-end gap-3"><MapPin size={16} className="shrink-0" /> {settings?.address || "Av. Principal 123, Ciudad"}</li>
              {settings?.contact_instagram && (
                <li className="flex items-center justify-start md:justify-end gap-3"><Instagram size={16} className="shrink-0" /> {settings.contact_instagram}</li>
              )}
              <li className="flex items-center justify-start md:justify-end gap-3"><Phone size={16} className="shrink-0" /> {settings?.contact_phone || "+1 (555) 000-0000"}</li>
            </ul>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-6 mt-16 pt-8 border-t border-slate-800 text-sm font-light flex justify-between items-center">
          <p>© {new Date().getFullYear()} {settings?.name || "The Hotel"}. Todos los derechos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
