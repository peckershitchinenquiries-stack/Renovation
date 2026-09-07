import { notFound } from "next/navigation";
import { getProject, getPurchaseOrders } from "@/lib/data";
import OrdersScreen from "@/components/orders/OrdersScreen";

export const dynamic = "force-dynamic";

/**
 * Purchase orders (migration 0023) — the half of the money the app has never
 * had.
 *
 * `purchases` records a document that has already been issued to you. This
 * records the one you sent, and `purchases.purchase_order_id` is the match
 * between them, which is where over-delivery and price creep get caught.
 *
 * Its own route rather than a project tab, for the same reason as Documents:
 * nothing here is spend, so it does not belong on a strip of tabs that are all
 * different views of the spend.
 */
export default async function OrdersPage({
  params,
}: {
  params: { id: string };
}) {
  const list = await getPurchaseOrders(params.id);

  if (!list) {
    const project = await getProject(params.id);
    if (!project) notFound();
    return <OrdersScreen list={null} project={project} />;
  }

  return <OrdersScreen list={list} project={list.project} />;
}
