import Link from "next/link";
import Image from "next/image";
import { Star, MapPin, UtensilsCrossed, BedDouble, Fuel, Instagram, Phone, Mail } from "lucide-react";
import PublicSearchForm from "./components/PublicSearchForm";
import RoomCard from "./components/RoomCard";
import ScrollToResults from "./components/ScrollToResults";
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
      const typeName = room.room_type;
      typeCounts.set(typeName, (typeCounts.get(typeName) || 0) + 1);
    }
    const parts: string[] = [];
    for (const [type, count] of typeCounts.entries()) {
      parts.push(`${count} habitaci\u00f3n ${type}`);
    }
    comboMessage = `No tenemos disponible una sola habitaci\u00f3n para ${searchGuests} personas, pero le podemos ofrecer la siguiente opci\u00f3n combinada: \u00a1${parts.join(" y ")}!`;
  }

  return (
    <div className="min-h-screen bg-stone-50 selection:bg-brand-500 selection:text-white font-sans scroll-smooth">
      {isSearching && <ScrollToResults />}

      {/* ── Navbar ── */}
      <nav className="absolute w-full z-50">
        <div className="max-w-7xl mx-auto px-6 h-24 flex items-center justify-between">
          {/* Solo logo, sin texto */}
          <Link href="/" className="shrink-0">
            {settings?.logo_url ? (
              <div className="relative w-20 h-20 flex items-center justify-center drop-shadow-lg">
                <Image src={settings.logo_url} alt={settings?.name || "El Refugio"} fill className="object-contain" />
              </div>
            ) : (
              <div className="w-14 h-14 bg-white/10 backdrop-blur-md rounded-xl flex items-center justify-center border border-white/20">
                <Star className="text-white fill-white/80" size={24} />
              </div>
            )}
          </Link>

          <div className="hidden md:flex gap-8 items-center text-sm font-semibold tracking-wide text-white/90 uppercase">
            <a href="#habitaciones" className="hover:text-white transition-colors relative after:absolute after:bottom-[-4px] after:left-0 after:w-0 after:h-[2px] after:bg-brand-400 after:transition-all hover:after:w-full">
              Habitaciones
            </a>
            <a href="#servicios" className="hover:text-white transition-colors relative after:absolute after:bottom-[-4px] after:left-0 after:w-0 after:h-[2px] after:bg-brand-400 after:transition-all hover:after:w-full">
              Servicios
            </a>
            <a href="#ubicacion" className="hover:text-white transition-colors relative after:absolute after:bottom-[-4px] after:left-0 after:w-0 after:h-[2px] after:bg-brand-400 after:transition-all hover:after:w-full">
              Ubicaci&oacute;n
            </a>
            <Link
              href="/admin"
              className="ml-2 px-5 py-2.5 rounded-lg bg-white/10 backdrop-blur-md text-white border border-white/20 hover:bg-white hover:text-slate-900 transition-all duration-300"
            >
              Acceso Staff
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero Section ── */}
      <section className="relative min-h-[92vh] flex items-center justify-center pt-20 overflow-hidden">
        <div className="absolute inset-0">
          <Image
            src={settings?.hero_image_url || "https://images.unsplash.com/photo-1545642412-ea820db826a7?auto=format&fit=crop&q=80&w=2000"}
            alt="Hotel El Refugio"
            fill
            priority
            className="object-cover"
          />
          {/* Overlays mejorados - la imagen se ve mucho mejor */}
          <div className="absolute inset-0 bg-gradient-to-b from-slate-950/70 via-slate-900/30 to-stone-50"></div>
        </div>

        <div className="relative z-10 max-w-7xl mx-auto px-6 w-full text-center mt-8 mb-32">
          {/* Subtitulo arriba del titulo principal */}
          {settings?.hero_subtitle && (
            <p className="text-sm md:text-base font-medium tracking-[0.3em] uppercase text-white/70 mb-6 animate-fade-up">
              {settings.hero_subtitle}
            </p>
          )}

          <h1 className="text-5xl md:text-7xl lg:text-8xl font-serif text-white mb-8 leading-[1.1] drop-shadow-2xl animate-fade-up" style={{ animationDelay: '0.1s' }}>
            {settings?.hero_title || "Tu refugio en el camino"}
          </h1>

          {/* Buscador */}
          <div className="max-w-5xl mx-auto transform translate-y-1/2 absolute left-0 right-0 bottom-0 px-6 animate-fade-up" style={{ animationDelay: '0.3s' }}>
            <PublicSearchForm />
          </div>
        </div>
      </section>

      {/* Espaciador para el buscador absolutizado */}
      <div className="h-32 md:h-16"></div>

      {/* ── Seccion Habitaciones ── */}
      <section id="habitaciones" className="py-24 bg-stone-50 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <p className="text-xs font-bold tracking-[0.3em] text-brand-600 uppercase mb-3">Alojamiento</p>
            <h2 className="text-4xl md:text-5xl font-serif text-slate-900 mb-6">
              {isSearching ? "Disponibilidad" : "Nuestras Habitaciones"}
            </h2>
            <div className="w-16 h-[2px] bg-brand-500 mx-auto mb-6"></div>
            <p className="text-slate-500 max-w-2xl mx-auto text-lg font-light leading-relaxed">
              {isSearching
                ? `Mostrando opciones del ${new Date(`${checkin}T12:00:00Z`).toLocaleDateString("es-AR")} al ${new Date(`${checkout}T12:00:00Z`).toLocaleDateString("es-AR")}`
                : "Habitaciones c\u00f3modas y silenciosas, pensadas para que descanses de verdad despu\u00e9s de la ruta."}
            </p>
          </div>

          {comboMessage && (
            <div className="max-w-3xl mx-auto mb-10 p-6 bg-brand-50 border border-brand-200 text-brand-800 rounded-xl text-center shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-500">
              <p className="text-lg font-medium">{comboMessage}</p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {isSearching ? (
              availableRooms.length > 0 ? (
                availableRooms.map((room) => (
                  <RoomCard
                    key={room.id}
                    room={room}
                    checkIn={checkin || ""}
                    checkOut={checkout || ""}
                    isAvailable={true}
                    checkInTime={settings.standard_check_in_time?.substring(0, 5)}
                    checkOutTime={settings.standard_check_out_time?.substring(0, 5)}
                    timezone={settings.timezone}
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
                  checkInTime={settings.standard_check_in_time?.substring(0, 5)}
                  checkOutTime={settings.standard_check_out_time?.substring(0, 5)}
                  timezone={settings.timezone}
                />
              ))
            )}
          </div>

          {isSearching && availableRooms.length === 0 && (
            <div className="mt-16 max-w-2xl mx-auto p-12 bg-white border border-slate-200 text-center rounded-2xl shadow-sm">
              <h3 className="text-2xl font-serif text-slate-800 mb-3">Sin disponibilidad</h3>
              <p className="text-slate-500 font-light leading-relaxed">
                Lamentablemente, nuestras habitaciones est&aacute;n completamente reservadas para las fechas seleccionadas.
                Le invitamos a probar con otro rango de fechas.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ── Servicios ── */}
      <section id="servicios" className="py-24 bg-white border-y border-stone-200 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          <div>
            <p className="text-xs font-bold tracking-[0.3em] text-brand-600 uppercase mb-3">Facilidades</p>
            <h2 className="text-4xl md:text-5xl font-serif text-slate-900 mb-4">
              Servicios Integrales de Ruta
            </h2>
            <div className="w-16 h-[2px] bg-brand-500 mb-8"></div>
            <p className="text-slate-500 font-light text-lg mb-12 leading-relaxed">
              En El Refugio entendemos el valor de tu tiempo y la importancia de un buen descanso. Todo lo que necesit&aacute;s en un solo lugar.
            </p>

            <div className="space-y-8">
              {/* Comedor Regional */}
              <div className="flex items-start gap-5 group">
                <div className="mt-0.5 w-12 h-12 rounded-xl bg-orange-50 flex items-center justify-center shrink-0 border border-orange-100 group-hover:bg-orange-100 transition-colors">
                  <UtensilsCrossed size={22} className="text-orange-600" />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-slate-900 mb-1">Comedor Regional</h4>
                  <p className="text-slate-500 font-light text-sm leading-relaxed">Platos caseros y abundantes con el sabor del norte, ideales para reponer fuerzas en cualquier momento del d&iacute;a.</p>
                </div>
              </div>

              {/* Hotel */}
              <div className="flex items-start gap-5 group">
                <div className="mt-0.5 w-12 h-12 rounded-xl bg-brand-50 flex items-center justify-center shrink-0 border border-brand-100 group-hover:bg-brand-100 transition-colors">
                  <BedDouble size={22} className="text-brand-700" />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-slate-900 mb-1">Hotel El Refugio</h4>
                  <p className="text-slate-500 font-light text-sm leading-relaxed">Habitaciones dise&ntilde;adas para un descanso real, silenciosas y seguras, pensadas espec&iacute;ficamente para el viajero y el transportista.</p>
                </div>
              </div>

              {/* Repuestera y Combustibles */}
              <div className="flex items-start gap-5 group">
                <div className="mt-0.5 w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0 border border-blue-100 group-hover:bg-blue-100 transition-colors">
                  <Fuel size={22} className="text-blue-600" />
                </div>
                <div>
                  <h4 className="text-lg font-bold text-slate-900 mb-1">Repuestera y Combustibles</h4>
                  <p className="text-slate-500 font-light text-sm leading-relaxed">Carga de combustible de confianza y un stock estrat&eacute;gico de repuestos cr&iacute;ticos para resolver cualquier imprevisto mec&aacute;nico en el acto.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Imagen de servicios */}
          <div className="relative h-[550px] w-full rounded-2xl overflow-hidden shadow-2xl shadow-slate-200/50">
            <Image
              src={settings?.services_image_url || "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&q=80&w=1000"}
              alt="Servicios del Hotel"
              fill
              sizes="(max-width: 1024px) 100vw, 50vw"
              className="object-cover"
            />
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer id="ubicacion" className="bg-slate-950 text-slate-400 py-20 scroll-mt-20">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row gap-12 justify-between">
          {/* Solo logo, sin texto */}
          <div className="max-w-md">
            <div className="mb-8">
              {settings?.logo_url ? (
                <div className="relative w-24 h-24 flex items-center justify-center">
                  <Image src={settings.logo_url} alt={settings?.name || "El Refugio"} fill className="object-contain brightness-0 invert" />
                </div>
              ) : (
                <div className="w-14 h-14 bg-white/10 flex items-center justify-center rounded-xl border border-white/10">
                  <Star className="text-white fill-white/80" size={24} />
                </div>
              )}
            </div>
            {settings?.address && (
              <p className="text-slate-500 font-light text-sm leading-relaxed max-w-xs">
                <MapPin size={14} className="inline mr-2 relative -top-[1px]" />
                {settings.address}
              </p>
            )}
          </div>

          {/* Contacto */}
          <div className="text-left md:text-right flex flex-col items-start md:items-end">
            <h4 className="text-white font-bold tracking-[0.2em] uppercase text-xs mb-6">Contacto</h4>
            <ul className="space-y-4 font-light text-sm">
              {settings?.contact_email && (
                <li className="flex items-center justify-start md:justify-end gap-3 hover:text-white transition-colors">
                  <Mail size={16} className="shrink-0" /> {settings.contact_email}
                </li>
              )}
              {settings?.contact_instagram && (
                <li className="flex items-center justify-start md:justify-end gap-3 hover:text-white transition-colors">
                  <Instagram size={16} className="shrink-0" /> {settings.contact_instagram}
                </li>
              )}
              <li className="flex items-center justify-start md:justify-end gap-3 hover:text-white transition-colors">
                <Phone size={16} className="shrink-0" /> {settings?.contact_phone || "+54 (000) 000-0000"}
              </li>
            </ul>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 mt-16 pt-8 border-t border-slate-800/50 text-xs font-light flex justify-between items-center text-slate-600">
          <p>&copy; {new Date().getFullYear()} {settings?.name || "El Refugio"}. Todos los derechos reservados.</p>
        </div>
      </footer>
    </div>
  );
}
