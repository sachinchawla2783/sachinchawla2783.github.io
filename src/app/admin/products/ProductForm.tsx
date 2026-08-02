import type { Category, Product } from "@prisma/client";

export function ProductForm({
  action,
  product,
  categories,
}: {
  action: (formData: FormData) => void;
  product?: Product;
  categories: Category[];
}) {
  return (
    <form action={action} className="flex max-w-2xl flex-col gap-5">
      <Field label="Slug" name="slug" defaultValue={product?.slug} required />
      <Field label="Name" name="name" defaultValue={product?.name} required />
      <Field label="Tagline" name="tagline" defaultValue={product?.tagline} required />
      <TextArea label="Description" name="description" defaultValue={product?.description} required />
      <TextArea label="Science" name="science" defaultValue={product?.science} />
      <TextArea label="How to Use" name="howToUse" defaultValue={product?.howToUse} />
      <TextArea label="Research" name="research" defaultValue={product?.research} />
      <Field
        label="Price (cents)"
        name="price"
        type="number"
        defaultValue={product?.price?.toString()}
        required
      />

      <div>
        <label className="mb-2 block text-micro uppercase tracking-widest2 font-mono">
          Category
        </label>
        <select
          name="categorySlug"
          defaultValue=""
          className="w-full border border-stone-300 bg-off-white px-4 py-3 text-sm focus:border-ink focus:outline-none"
        >
          <option value="">None</option>
          {categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="featured" defaultChecked={product?.featured} />
        Featured on homepage
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={product?.active ?? true} />
        Active (visible in store)
      </label>

      <button type="submit" className="btn-primary mt-4 w-fit">
        {product ? "Save Changes" : "Create Product"}
      </button>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-2 block text-micro uppercase tracking-widest2 font-mono">{label}</label>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        required={required}
        className="w-full border border-stone-300 bg-transparent px-4 py-3 text-sm focus:border-ink focus:outline-none"
      />
    </div>
  );
}

function TextArea({
  label,
  name,
  defaultValue,
  required,
}: {
  label: string;
  name: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="mb-2 block text-micro uppercase tracking-widest2 font-mono">{label}</label>
      <textarea
        name={name}
        defaultValue={defaultValue}
        required={required}
        rows={4}
        className="w-full border border-stone-300 bg-transparent px-4 py-3 text-sm focus:border-ink focus:outline-none"
      />
    </div>
  );
}
