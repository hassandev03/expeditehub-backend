const mongoose = require('mongoose');
const Tenant = require('./src/modules/tenants/tenant.model');
const MenuItem = require('./src/modules/menuItems/menuItem.model');
require('dotenv').config();

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');

  const tenant = await Tenant.findOne({ name: /Abasyn/i });
  if (!tenant) {
    console.log('Tenant Abasyn not found');
    process.exit(1);
  }

  console.log('Found tenant:', tenant.name, tenant._id);

  const items = [
    { name: "Chicken Samosa (2 pcs)", price: 150, category: "Starters", description: "Crispy fried pastry filled with spiced minced chicken.", imageUrl: "https://loremflickr.com/400/300/samosa,food?random=1" },
    { name: "Beef Seekh Kebab", price: 450, category: "Starters", description: "Juicy minced beef kebabs grilled over charcoal.", imageUrl: "https://loremflickr.com/400/300/kebab,food?random=2" },
    { name: "Chana Chaat", price: 200, category: "Starters", description: "Tangy and spicy chickpea salad with yogurt and tamarind chutney.", imageUrl: "https://loremflickr.com/400/300/chaat,food?random=3" },
    { name: "Dahi Bhallay", price: 250, category: "Starters", description: "Soft lentil fritters soaked in spiced yogurt.", imageUrl: "https://loremflickr.com/400/300/yogurt,food?random=4" },
    
    { name: "Chicken Karahi (Half)", price: 1200, category: "Mains", description: "Traditional chicken karahi cooked with tomatoes, green chilies, and black pepper.", imageUrl: "https://loremflickr.com/400/300/curry,food?random=5" },
    { name: "Chicken Karahi (Full)", price: 2200, category: "Mains", description: "Full portion of our famous traditional chicken karahi.", imageUrl: "https://loremflickr.com/400/300/curry,food?random=6" },
    { name: "Mutton Karahi (Half)", price: 1800, category: "Mains", description: "Tender mutton pieces cooked in a rich tomato and ginger base.", imageUrl: "https://loremflickr.com/400/300/meat,food?random=7" },
    { name: "Mutton Karahi (Full)", price: 3500, category: "Mains", description: "Full portion of our premium mutton karahi.", imageUrl: "https://loremflickr.com/400/300/meat,food?random=8" },
    { name: "Chicken Makhni Handi", price: 1500, category: "Mains", description: "Boneless chicken cooked in a creamy buttery tomato sauce.", imageUrl: "https://loremflickr.com/400/300/butterchicken,food?random=9" },
    { name: "Paneer Reshmi Handi", price: 1300, category: "Mains", description: "Cottage cheese cubes in a silky white sauce.", imageUrl: "https://loremflickr.com/400/300/paneer,food?random=10" },

    { name: "Chicken Biryani", price: 400, category: "Rice", description: "Aromatic basmati rice cooked with spicy marinated chicken.", imageUrl: "https://loremflickr.com/400/300/biryani,food?random=11" },
    { name: "Beef Biryani", price: 450, category: "Rice", description: "Spicy and flavorful beef biryani with tender meat cuts.", imageUrl: "https://loremflickr.com/400/300/biryani,food?random=12" },
    { name: "Mutton Pulao", price: 600, category: "Rice", description: "Fragrant pulao made with mutton broth and whole spices.", imageUrl: "https://loremflickr.com/400/300/pulao,food?random=13" },
    { name: "Zeera Rice", price: 250, category: "Rice", description: "Steamed basmati rice tempered with cumin seeds.", imageUrl: "https://loremflickr.com/400/300/rice,food?random=14" },

    { name: "Chicken Tikka Boti", price: 450, category: "BBQ", description: "Spicy marinated boneless chicken pieces grilled to perfection.", imageUrl: "https://loremflickr.com/400/300/tikka,food?random=15" },
    { name: "Malai Boti", price: 500, category: "BBQ", description: "Creamy, melt-in-your-mouth grilled chicken bites.", imageUrl: "https://loremflickr.com/400/300/bbq,food?random=16" },
    { name: "Reshmi Kebab", price: 450, category: "BBQ", description: "Silky textured minced chicken kebabs.", imageUrl: "https://loremflickr.com/400/300/kebab,food?random=17" },
    { name: "Mutton Chops", price: 1200, category: "BBQ", description: "Succulent mutton chops marinated in special spices and grilled.", imageUrl: "https://loremflickr.com/400/300/meat,food?random=18" },

    { name: "Plain Naan", price: 40, category: "Breads", description: "Freshly baked soft flatbread.", imageUrl: "https://loremflickr.com/400/300/naan,food?random=19" },
    { name: "Roghni Naan", price: 80, category: "Breads", description: "Soft naan brushed with butter and sesame seeds.", imageUrl: "https://loremflickr.com/400/300/naan,food?random=20" },
    { name: "Garlic Naan", price: 100, category: "Breads", description: "Naan topped with minced garlic and fresh coriander.", imageUrl: "https://loremflickr.com/400/300/bread,food?random=21" },
    { name: "Tandoori Roti", price: 30, category: "Breads", description: "Whole wheat flatbread baked in a clay oven.", imageUrl: "https://loremflickr.com/400/300/roti,food?random=22" },

    { name: "Kheer", price: 250, category: "Desserts", description: "Traditional rice pudding flavored with cardamom and nuts.", imageUrl: "https://loremflickr.com/400/300/dessert,food?random=23" },
    { name: "Gulab Jamun (2 pcs)", price: 150, category: "Desserts", description: "Deep fried dough balls soaked in sweet sugar syrup.", imageUrl: "https://loremflickr.com/400/300/sweets,food?random=24" },
    { name: "Rabri", price: 300, category: "Desserts", description: "Rich condensed milk dessert topped with pistachios.", imageUrl: "https://loremflickr.com/400/300/dessert,food?random=25" }
  ];

  const docs = items.map(item => ({
    ...item,
    tenantId: tenant._id,
    isAvailable: true
  }));

  await MenuItem.insertMany(docs);
  console.log('Inserted 25 items successfully.');
  process.exit(0);
}

seed().catch(err => {
  console.error(err);
  process.exit(1);
});
